// supabase/functions/get-my-banners/index.ts
//
// Player-facing endpoint: the Home banners this guardian should see today,
// newest first (the Home screen shows the first one they haven't
// dismissed), plus which one, if any, puts "New" on the Shop tab.
//
//   GET /get-my-banners -> { banners: [...], shopNewId: string | null }
//
// Banners are posted in Club Management -> Messages -> Home banners. A
// banner is included if it's running today (South African dates), is for
// everyone or one of the guardian's children's age groups, and - for shop
// banners - only while the shop is open. Read with the service-role key;
// guardians can't read the table directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { saDate } from "../_shared/dates.js";
import { pickBanners, bannerView } from "../_shared/banners.js";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { computeAgeGroup } from "../_shared/billing.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BANNER_PHOTOS = `${SUPABASE_URL}/storage/v1/object/public/banner-photos`;
const STORE_PHOTOS = `${SUPABASE_URL}/storage/v1/object/public/store-photos`;

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

  const { data: playerIds, error: rpcErr } = await callerClient.rpc("current_player_ids");
  if (rpcErr || !playerIds || playerIds.length === 0) return json({ banners: [], shopNewId: null });

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-banners", { maxRequests: 60, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  const today = saDate();
  const [playersRes, bannersRes, settingsRes] = await Promise.all([
    adminClient.from("players").select("id, dob, age_group_override").in("id", playerIds),
    adminClient.from("home_banners")
      .select("id, title, message, button_kind, button_label, link_url, location_link, photo_path, show_product_strip, mark_shop_new, starts_on, ends_on, target_age_group, created_at")
      .lte("starts_on", today).gte("ends_on", today).limit(50),
    adminClient.from("store_settings").select("shop_open").eq("id", 1).maybeSingle(),
  ]);
  if (playersRes.error || bannersRes.error) {
    console.error("get-my-banners: load failed", playersRes.error || bannersRes.error);
    return json({ error: "Could not load banners - please try again." }, 500);
  }

  const ageGroups = (playersRes.data ?? []).map((p) => (p.age_group_override || computeAgeGroup(p.dob)).trim().toLowerCase());
  const shopOpen = !!settingsRes.data?.shop_open;
  const picked = pickBanners(bannersRes.data ?? [], { ageGroups, today, shopOpen });

  let productPhotos: string[] = [];
  if (picked.some((b) => b.button_kind === "shop" && b.show_product_strip)) {
    const { data: products } = await adminClient.from("store_products")
      .select("photo_path").eq("visible", true).not("photo_path", "is", null)
      .order("sort_order", { ascending: true }).limit(3);
    productPhotos = (products ?? []).map((p) => `${STORE_PHOTOS}/${p.photo_path}`);
  }

  const banners = picked.slice(0, 10).map((b) => bannerView(b, { photoBase: BANNER_PHOTOS, productPhotos }));
  const shopNew = banners.find((b) => b.markShopNew);
  return json({ banners, shopNewId: shopNew ? shopNew.id : null });
});
