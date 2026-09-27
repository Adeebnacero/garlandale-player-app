// Home banner helpers for the get-my-banners Edge Function. Pure, no
// imports, tested with: deno test supabase/functions/_shared/

/**
 * The banners a guardian should see today, newest first: running today
 * (South African dates, inclusive), meant for everyone or for one of their
 * children's age groups, and - for shop banners - only while the shop is
 * open. ageGroups are lower-case.
 */
export function pickBanners(rows, { ageGroups, today, shopOpen }) {
  const groups = new Set((ageGroups || []).map((g) => String(g).trim().toLowerCase()));
  return (rows || [])
    .filter((b) => b.starts_on <= today && b.ends_on >= today)
    .filter((b) => {
      const t = String(b.target_age_group || "").trim().toLowerCase();
      return t === "" || t === "all" || groups.has(t);
    })
    .filter((b) => b.button_kind !== "shop" || shopOpen)
    .sort((a, b) =>
      String(b.starts_on).localeCompare(String(a.starts_on)) ||
      String(b.created_at).localeCompare(String(a.created_at)));
}

const BUTTON_TEXT = { shop: "Browse the shop", fixtures: "View fixtures", notices: "Read more", directions: "Directions" };

/** Shapes one banner for the Home screen. productPhotos: URLs for shop banners. */
export function bannerView(row, { photoBase, productPhotos = [] }) {
  let button = null;
  if (row.button_kind === "link" && row.link_url) button = { kind: "link", text: row.button_label || "Open link", url: row.link_url };
  else if (row.button_kind === "directions" && row.location_link) button = { kind: "directions", text: BUTTON_TEXT.directions, url: row.location_link };
  else if (BUTTON_TEXT[row.button_kind]) button = { kind: row.button_kind, text: BUTTON_TEXT[row.button_kind] };
  return {
    id: row.id,
    title: row.title,
    message: row.message || "",
    photoUrl: row.photo_path ? `${photoBase}/${row.photo_path}` : null,
    productPhotos: row.button_kind === "shop" && row.show_product_strip ? productPhotos.slice(0, 3) : [],
    button,
    markShopNew: row.button_kind === "shop" && !!row.mark_shop_new,
  };
}
