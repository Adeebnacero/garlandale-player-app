import { describe, it, expect } from "vitest";
import { validateBanner, bannerStatus, daysLeft, buttonText, blankBanner, addDays, todaySA, fromDbBanner } from "./banners.js";

const admin = { canTargetAll: true };
const coach = { canTargetAll: false, allowedGroups: ["U12"] };
const base = (o = {}) => ({ ...blankBanner("2026-09-27"), title: "Prize-giving", ...o });

describe("dates", () => {
  it("adds days and knows South African today", () => {
    expect(addDays("2026-09-27", 13)).toBe("2026-10-10");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(todaySA(new Date("2026-09-26T22:30:00Z"))).toBe("2026-09-27");
  });
  it("defaults to two weeks from today", () => {
    const b = blankBanner("2026-09-27");
    expect([b.startsOn, b.endsOn]).toEqual(["2026-09-27", "2026-10-10"]);
  });
  it("works out status and days left", () => {
    const b = { startsOn: "2026-09-27", endsOn: "2026-10-10" };
    expect(bannerStatus(b, "2026-09-26")).toBe("scheduled");
    expect(bannerStatus(b, "2026-09-27")).toBe("live");
    expect(bannerStatus(b, "2026-10-10")).toBe("live");
    expect(bannerStatus(b, "2026-10-11")).toBe("ended");
    expect(daysLeft(b, "2026-09-27")).toBe(14);
    expect(daysLeft(b, "2026-10-10")).toBe(1);
  });
});

describe("validateBanner", () => {
  it("accepts a simple banner for everyone", () => {
    const r = validateBanner(base({ message: " Saturday 14:00 " }), admin);
    expect(r.ok).toBe(true);
    expect(r.row).toMatchObject({ title: "Prize-giving", message: "Saturday 14:00", button_kind: "none", target_age_group: "ALL", target_age_groups: [], link_url: null });
  });
  it("needs a heading and sensible dates", () => {
    expect(validateBanner(base({ title: " " }), admin).errors.title).toBeTruthy();
    expect(validateBanner(base({ endsOn: "2026-09-26" }), admin).errors.ends).toMatch(/on or after/);
    expect(validateBanner(base({ endsOn: "2026-12-31" }), admin).errors.ends).toMatch(/at most/);
    expect(validateBanner(base({ endsOn: addDays("2026-09-27", 90) }), admin).ok).toBe(true);
  });
  it("checks web links", () => {
    expect(validateBanner(base({ buttonKind: "link", linkUrl: "http://x.com", buttonLabel: "Go" }), admin).errors.link).toBeTruthy();
    expect(validateBanner(base({ buttonKind: "link", linkUrl: "javascript:alert(1)", buttonLabel: "Go" }), admin).errors.link).toBeTruthy();
    expect(validateBanner(base({ buttonKind: "link", linkUrl: "https://forms.gle/abc" }), admin).errors.label).toBeTruthy();
    const ok = validateBanner(base({ buttonKind: "link", linkUrl: " https://forms.gle/abc ", buttonLabel: "Register now" }), admin);
    expect(ok.row).toMatchObject({ button_kind: "link", link_url: "https://forms.gle/abc", button_label: "Register now" });
  });
  it("checks Directions uses a Google Maps link", () => {
    expect(validateBanner(base({ buttonKind: "directions", locationLink: "https://evil.com" }), admin).errors.location).toBeTruthy();
    expect(validateBanner(base({ buttonKind: "directions", locationLink: "https://maps.app.goo.gl/AbC123" }), admin).row.location_link).toBe("https://maps.app.goo.gl/AbC123");
  });
  it("keeps shop options for shop banners only", () => {
    const shop = validateBanner(base({ buttonKind: "shop", showProductStrip: true, markShopNew: true }), admin).row;
    expect([shop.show_product_strip, shop.mark_shop_new]).toEqual([true, true]);
    const other = validateBanner(base({ buttonKind: "fixtures", showProductStrip: true, markShopNew: true }), admin).row;
    expect([other.show_product_strip, other.mark_shop_new]).toEqual([false, false]);
  });
  it("carries the supporters option", () => {
    expect(validateBanner(base({ showToSupporters: true }), admin).row.show_to_supporters).toBe(true);
    expect(validateBanner(base({}), admin).row.show_to_supporters).toBe(false);
  });
  it("limits coaches to their own teams", () => {
    expect(validateBanner(base({ targetAgeGroups: [] }), coach).errors.target).toBeTruthy();
    expect(validateBanner(base({ targetAgeGroups: ["U14"] }), coach).errors.target).toBeTruthy();
    expect(validateBanner(base({ targetAgeGroups: ["U12", "U14"] }), coach).errors.target).toBeTruthy();
    expect(validateBanner(base({ targetAgeGroups: ["U12"] }), coach).ok).toBe(true);
  });
  it("takes several age groups", () => {
    const r = validateBanner(base({ targetAgeGroups: ["U9", "U7", "U8"] }), admin).row;
    expect(r.target_age_groups).toEqual(["U7", "U8", "U9"]);
    expect(r.target_age_group).toBe("U7");
  });
});

describe("display helpers", () => {
  it("names the button", () => {
    expect(buttonText({ buttonKind: "shop" })).toBe("Browse the shop");
    expect(buttonText({ buttonKind: "notices" })).toBe("Read more");
    expect(buttonText({ buttonKind: "link", buttonLabel: "Buy tickets" })).toBe("Buy tickets");
    expect(buttonText({ buttonKind: "none" })).toBe("");
  });
  it("maps rows", () => {
    const b = fromDbBanner({ id: "x", title: "T", button_kind: "shop", starts_on: "2026-09-27", ends_on: "2026-10-10", target_age_group: null });
    expect(b.targetAgeGroups).toEqual([]);
  });
});
