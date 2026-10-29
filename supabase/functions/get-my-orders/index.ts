// supabase/functions/get-my-orders/index.ts
//
// Player-facing endpoint: the logged-in guardian's club shop orders.
//
//   GET /get-my-orders                 -> { orders: [...] } (paid orders, newest first)
//   GET /get-my-orders?order_id=<id>   -> { order: {...} | null, paymentStatus }
//
// The single-order form is what shop.html polls after Yoco sends the
// guardian back, until the webhook has confirmed the payment
// (paymentStatus goes from "awaiting_payment" to "paid").
//
// Reads with the service-role key, always filtered to the caller's own
// auth user id, so a guardian can never see anyone else's orders.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { orderView } from "../_shared/store.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SELECT = "id, order_number, status, paid_at, subtotal, admin_fee, admin_fee_percent, total, refunded_total, guardian_name, guardian_phone, guardian_email, store_order_items(product_name, size_label, quantity, unit_price, is_preorder, status, sort_order)";

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // Generous limit: shop.html polls this for a few seconds after payment.
  const rl = await checkRateLimit(adminClient, userId, "get-my-orders", { maxRequests: 90, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  const orderId = new URL(req.url).searchParams.get("order_id");
  if (orderId) {
    if (!UUID_RE.test(orderId)) return json({ error: "Invalid order id" }, 400);
    const { data: row, error } = await adminClient
      .from("store_orders").select(SELECT).eq("id", orderId).eq("auth_user_id", userId).maybeSingle();
    if (error) {
      console.error("get-my-orders: failed to load order", error);
      return json({ error: "Could not load your order - please try again." }, 500);
    }
    if (!row) return json({ order: null, paymentStatus: "not_found" });
    return json({ order: row.status === "paid" ? orderView(row) : null, paymentStatus: row.status });
  }

  const { data: rows, error } = await adminClient
    .from("store_orders")
    .select(SELECT)
    .eq("auth_user_id", userId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("get-my-orders: failed to load orders", error);
    return json({ error: "Could not load your orders - please try again." }, 500);
  }
  return json({ orders: (rows ?? []).map(orderView) });
});
