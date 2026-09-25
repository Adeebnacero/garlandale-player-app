// supabase/functions/get-shop/index.ts
//
// Player-facing endpoint: returns the club shop - whether it's open, the
// products guardians can buy (with sizes and a simple stock state), the
// admin fee percentage and the store policy.
//
//   GET /get-shop             -> full shop
//   GET /get-shop?summary=1   -> { open } only, for showing the Shop tab
//
// Read-only. Store tables have no guardian read access (RLS is staff-only),
// so this reads with the service-role key and returns only what guardians
// should see: hidden products and closed pre-orders are left out, and
// exact stock is only revealed when it's low (see _shared/store.js).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { shopProductView, todayInSA } from "../_shared/store.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTO_BASE = `${SUPABASE_URL}/storage/v1/object/public/store-photos`;

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

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userData.user.id, "get-shop", { maxRequests: 60, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  const { data: settings, error: settingsErr } = await adminClient
    .from("store_settings")
    .select("shop_open, admin_fee_percent, contact_email, contact_phone, policy_text")
    .eq("id", 1)
    .maybeSingle();
  if (settingsErr) {
    console.error("get-shop: failed to load settings", settingsErr);
    return json({ error: "Could not load the shop - please try again." }, 500);
  }

  const open = !!settings?.shop_open;
  if (new URL(req.url).searchParams.get("summary") === "1" || !open) {
    return json({ open });
  }

  const { data: rows, error: productsErr } = await adminClient
    .from("store_products")
    .select("id, name, description, price, sale_mode, has_sizes, stock, preorder_closes_on, preorder_expected, visible, photo_path, sort_order, store_product_sizes(id, label, stock, sort_order)")
    .eq("visible", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (productsErr) {
    console.error("get-shop: failed to load products", productsErr);
    return json({ error: "Could not load the shop - please try again." }, 500);
  }

  const today = todayInSA();
  const products = (rows ?? []).map((r) => shopProductView(r, today, PHOTO_BASE)).filter(Boolean);

  return json({
    open,
    adminFeePercent: Number(settings!.admin_fee_percent),
    contactEmail: settings!.contact_email || "",
    contactPhone: settings!.contact_phone || "",
    policyText: settings!.policy_text || "",
    products,
  });
});
