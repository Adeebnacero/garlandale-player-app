// supabase/functions/yoco-webhook/index.ts
//
// PUBLIC endpoint - called directly by Yoco's servers, never by the
// player app itself, so there's no caller JWT to check here. Trust comes
// entirely from verifying the webhook-signature header (see
// _shared/yoco.js) plus requiring event type === "payment.succeeded".
//
// Replaces the previous payfast-itn function (removed).
//
// On a genuine, validated, successful payment: insert one row into
// `payments` for the amount Yoco confirms was actually paid, scoped to
// the player id carried through in payload.metadata.playerId (set when
// create-yoco-checkout created the Checkout). Deliberately does NOT
// re-derive or touch balance/compliance directly - billing.js already
// sums the payments table to compute both, so this is the only write
// this function needs to make.
//
// Idempotency: Yoco (like most webhook providers) can and does retry
// deliveries. payload.id is Yoco's own unique payment id (e.g.
// "p_bx4bY9JA6r4UwAKFyAjHY2bE") - stored in payments.reference with a
// unique constraint, so a duplicate delivery of the same event is a
// no-op insert rather than a double-counted payment.
//
// Required secrets: YOCO_WEBHOOK_SECRET (starts with "whsec_", from the
// webhook's configuration in the Yoco Business Portal / Webhooks API).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyYocoWebhook } from "../_shared/yoco.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOCO_WEBHOOK_SECRET = Deno.env.get("YOCO_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!YOCO_WEBHOOK_SECRET) {
    console.error("yoco-webhook: YOCO_WEBHOOK_SECRET is not configured");
    // 500 here is fine (and arguably correct) - unlike a bad signature,
    // this is our own misconfiguration, not a signal to stop retrying.
    return new Response("webhook not configured", { status: 500 });
  }

  // Read the raw body ONCE, as text - the signature is computed over the
  // exact raw bytes Yoco sent. Re-serializing parsed JSON would produce a
  // different string and break verification.
  const rawBody = await req.text();

  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };

  const verification = await verifyYocoWebhook(rawBody, headers, YOCO_WEBHOOK_SECRET);
  if (!verification.ok) {
    console.error("yoco-webhook: signature verification failed", verification.reason);
    // Still 200 - a bad signature will never become valid on retry, and
    // returning an error status just causes Yoco to keep retrying it.
    return new Response("signature verification failed", { status: 200 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 200 });
  }

  // Only a successful payment ever creates a payments row. Yoco sends
  // webhooks for other event types too (payment.failed, refund.succeeded,
  // etc.) - those are acknowledged with 200 but never processed here.
  if (event?.type !== "payment.succeeded") {
    return new Response("acknowledged, not a successful payment", { status: 200 });
  }

  const payload = event.payload ?? {};
  const playerId = payload.metadata?.playerId;
  const amountCents = Number(payload.amount);
  const paymentRef = payload.id; // Yoco's payment id, e.g. "p_..."

  if (!playerId || !Number.isFinite(amountCents) || amountCents <= 0 || !paymentRef) {
    console.error("yoco-webhook: missing/invalid player id, amount, or payment id", {
      playerId, amount: payload.amount, paymentRef,
    });
    return new Response("missing player id, amount, or payment id", { status: 200 });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: player, error: playerErr } = await adminClient
    .from("players")
    .select("id")
    .eq("id", playerId)
    .single();

  if (playerErr || !player) {
    console.error("yoco-webhook: player not found for metadata.playerId", { playerId });
    return new Response("player not found", { status: 200 });
  }

  // Idempotent insert: `reference` has a unique constraint (see the
  // migration adding it), so a duplicate delivery for the same payment
  // just no-ops here instead of double-counting.
  const { error: insertErr } = await adminClient.from("payments").insert({
    player_id: playerId,
    amount: amountCents / 100,
    date: new Date().toISOString().slice(0, 10),
    method: "Yoco",
    reference: paymentRef,
  });

  if (insertErr) {
    // Unique violation on `reference` = we've already recorded this
    // payment from an earlier delivery of the same event - not an error.
    if (insertErr.code === "23505") {
      return new Response("already recorded", { status: 200 });
    }
    console.error("yoco-webhook: failed to insert payment", insertErr.message);
    return new Response("failed to record payment", { status: 200 });
  }

  return new Response("ok", { status: 200 });
});
