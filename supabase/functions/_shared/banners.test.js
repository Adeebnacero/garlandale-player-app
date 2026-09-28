// banners.test.js - run with: deno test supabase/functions/_shared/
import { pickBanners, bannerView } from "./banners.js";
function assertEquals(a, e, m) { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); }

const row = (o) => ({ id: "b", title: "T", starts_on: "2026-09-20", ends_on: "2026-10-10", target_age_group: "ALL", button_kind: "none", created_at: "2026-09-20T08:00:00Z", ...o });

Deno.test("only banners running today, for this child, newest first", () => {
  const rows = [
    row({ id: "old", starts_on: "2026-09-01", ends_on: "2026-09-26" }),
    row({ id: "future", starts_on: "2026-09-28" }),
    row({ id: "all" }),
    row({ id: "u12", target_age_group: "U12", starts_on: "2026-09-25" }),
    row({ id: "u14", target_age_group: "U14", starts_on: "2026-09-26" }),
    row({ id: "last-day", starts_on: "2026-09-10", ends_on: "2026-09-27" }),
  ];
  const ids = pickBanners(rows, { ageGroups: ["u12"], today: "2026-09-27", shopOpen: true }).map((b) => b.id);
  assertEquals(ids, ["u12", "all", "last-day"], "filtered and sorted");
});

Deno.test("banners for several age groups", () => {
  const rows = [row({ id: "u7-9", target_age_groups: ["U7", "U8", "U9"], target_age_group: "U7" }), row({ id: "u13", target_age_groups: ["U13"], target_age_group: "U13" })];
  assertEquals(pickBanners(rows, { ageGroups: ["u8"], today: "2026-09-27", shopOpen: true }).map((b) => b.id), ["u7-9"], "U8 child");
  assertEquals(pickBanners(rows, { ageGroups: ["u8", "u13"], today: "2026-09-27", shopOpen: true }).length, 2, "family with U8 and U13 sees each once");
  assertEquals(pickBanners(rows, { ageGroups: ["u11"], today: "2026-09-27", shopOpen: true }).length, 0, "U11 child");
});

Deno.test("shop banners only while the shop is open", () => {
  const rows = [row({ id: "shop", button_kind: "shop" }), row({ id: "event" })];
  assertEquals(pickBanners(rows, { ageGroups: [], today: "2026-09-27", shopOpen: false }).map((b) => b.id), ["event"], "closed");
  assertEquals(pickBanners(rows, { ageGroups: [], today: "2026-09-27", shopOpen: true }).length, 2, "open");
});

Deno.test("banner view", () => {
  const v = bannerView(row({ button_kind: "shop", show_product_strip: true, mark_shop_new: true, photo_path: "x/1.jpg" }),
    { photoBase: "https://p", productPhotos: ["a", "b", "c", "d"] });
  assertEquals([v.button.text, v.productPhotos.length, v.markShopNew, v.photoUrl], ["Browse the shop", 3, true, "https://p/x/1.jpg"], "shop");
  const l = bannerView(row({ button_kind: "link", link_url: "https://forms.gle/x", button_label: "Register" }), { photoBase: "" });
  assertEquals(l.button, { kind: "link", text: "Register", url: "https://forms.gle/x" }, "link");
  assertEquals(bannerView(row({}), { photoBase: "" }).button, null, "no button");
  assertEquals(bannerView(row({ button_kind: "fixtures", mark_shop_new: true }), { photoBase: "" }).markShopNew, false, "New only for shop");
});
