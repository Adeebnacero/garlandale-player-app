// ---------------------------------------------------------------------------
// Home banners: rules with no database or screen code, so they can be
// unit-tested (banners.test.js). Used by components/HomeBanners.jsx.
//
// A banner shows at the top of the Player Portal's Home screen between its
// start and end dates (inclusive, South African dates), to everyone or to
// one or more age groups. Only one banner shows at a time: the newest one currently
// running for that guardian's child. The database enforces the same limits
// (see migrations/2026-09-chairman-and-home-banners.sql).
// ---------------------------------------------------------------------------

import { parseMapsLink } from "./mapLinks.js";
import { groupsFromRow, audienceColumns, cleanGroups } from "./audience.js";

export const MAX_TITLE = 60;
export const MAX_MESSAGE = 200;
export const MAX_LABEL = 30;
export const MAX_DAYS = 91; // start day + 90

export const BUTTON_KINDS = [
  { id: "none", label: "No button" },
  { id: "shop", label: "Open the Shop", button: "Browse the shop" },
  { id: "fixtures", label: "Open Fixtures", button: "View fixtures" },
  { id: "notices", label: "Open Notices (read more)", button: "Read more" },
  { id: "link", label: "Open a web link", button: "" },
  { id: "directions", label: "Directions to a venue", button: "Directions" },
];

/** Adds days to a YYYY-MM-DD date. */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in South Africa (UTC+2), as YYYY-MM-DD. */
export function todaySA(now = new Date()) {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** scheduled | live | ended, for a banner on a given day. */
export function bannerStatus(banner, today) {
  if (banner.startsOn > today) return "scheduled";
  if (banner.endsOn < today) return "ended";
  return "live";
}

/** Whole days a live banner has left, counting today. */
export function daysLeft(banner, today) {
  const ms = new Date(`${banner.endsOn}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000) + 1;
}

/** The text on a banner's button, or "" for no button. */
export function buttonText(banner) {
  if (banner.buttonKind === "link") return (banner.buttonLabel || "").trim() || "Open link";
  return (BUTTON_KINDS.find((k) => k.id === banner.buttonKind) || {}).button || "";
}

export function fromDbBanner(row) {
  return {
    id: row.id,
    title: row.title || "",
    message: row.message || "",
    buttonKind: row.button_kind || "none",
    buttonLabel: row.button_label || "",
    linkUrl: row.link_url || "",
    locationLink: row.location_link || "",
    photoPath: row.photo_path || "",
    showProductStrip: !!row.show_product_strip,
    markShopNew: !!row.mark_shop_new,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    targetAgeGroups: groupsFromRow(row), // [] = everyone
    showToSupporters: !!row.show_to_supporters,
    postedBy: row.posted_by || null,
    postedByEmail: row.posted_by_email || "",
  };
}

/** A new banner running for two weeks from today. */
export function blankBanner(today, defaultTargets = []) {
  return {
    id: null, title: "", message: "", buttonKind: "none", buttonLabel: "", linkUrl: "", locationLink: "",
    photoPath: "", showProductStrip: false, markShopNew: false,
    startsOn: today, endsOn: addDays(today, 13), targetAgeGroups: defaultTargets, showToSupporters: false,
  };
}

function validHttps(url) {
  const s = String(url || "").trim();
  if (!s || s.length > 500 || /[\s"'<>`\\]/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Checks the banner form. canTargetAll: whether this person may post to
 * everyone (Admin, Chairman, Treasurer); allowedGroups: for coaches, their
 * own age groups. Returns { ok, errors, row } with row ready to save.
 */
export function validateBanner(draft, { canTargetAll, allowedGroups = [] }) {
  const errors = {};
  const title = String(draft.title || "").trim();
  if (!title) errors.title = "Enter a heading.";
  else if (title.length > MAX_TITLE) errors.title = `Keep the heading to ${MAX_TITLE} characters.`;

  const message = String(draft.message || "").trim();
  if (message.length > MAX_MESSAGE) errors.message = `Keep the message to ${MAX_MESSAGE} characters.`;

  const kind = BUTTON_KINDS.some((k) => k.id === draft.buttonKind) ? draft.buttonKind : "none";
  let linkUrl = null;
  let locationLink = null;
  let buttonLabel = "";
  if (kind === "link") {
    linkUrl = validHttps(draft.linkUrl);
    if (!linkUrl) errors.link = "Enter a secure web address starting with https://";
    buttonLabel = String(draft.buttonLabel || "").trim();
    if (!buttonLabel) errors.label = "Enter the button text, e.g. Register now.";
    else if (buttonLabel.length > MAX_LABEL) errors.label = `Keep the button text to ${MAX_LABEL} characters.`;
  }
  if (kind === "directions") {
    const r = parseMapsLink(draft.locationLink);
    if (r.error) errors.location = r.error;
    else if (!r.value) errors.location = "Paste the Google Maps link for the venue.";
    else locationLink = r.value;
  }

  const starts = String(draft.startsOn || "");
  const ends = String(draft.endsOn || "");
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(starts)) errors.starts = "Choose a start date.";
  if (!isDate(ends)) errors.ends = "Choose an end date.";
  if (isDate(starts) && isDate(ends)) {
    if (ends < starts) errors.ends = "The end date must be on or after the start date.";
    else if (ends > addDays(starts, MAX_DAYS - 1)) errors.ends = `A banner can run for at most ${MAX_DAYS} days.`;
  }

  const groups = cleanGroups(draft.targetAgeGroups || []);
  if (!canTargetAll) {
    if (groups.length === 0) errors.target = "Tick at least one of your teams.";
    else if (groups.some((g) => !allowedGroups.includes(g))) errors.target = "You can only post banners for your own teams.";
  }

  const isShop = kind === "shop";
  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    row: ok ? {
      title,
      message,
      button_kind: kind,
      button_label: buttonLabel,
      link_url: linkUrl,
      location_link: locationLink,
      show_product_strip: isShop && !!draft.showProductStrip,
      mark_shop_new: isShop && !!draft.markShopNew,
      starts_on: starts,
      ends_on: ends,
      ...audienceColumns(groups, "ALL"),
      show_to_supporters: !!draft.showToSupporters,
    } : null,
  };
}

/** Friendly messages for database errors on banners. */
export function friendlyBannerError(err) {
  const msg = String(err?.message || err || "");
  if (/row-level security/i.test(msg)) return "You can only post or change banners for your own teams.";
  if (/home_banners_link_check/.test(msg)) return "Enter a secure web address starting with https://";
  if (/home_banners_directions_check/.test(msg)) return "That isn’t a Google Maps link.";
  if (/home_banners_dates_check/.test(msg)) return `Check the dates: the end must be on or after the start, and a banner can run for at most ${MAX_DAYS} days.`;
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Couldn’t reach the server. Check your connection and try again.";
  return msg || "Something went wrong. Please try again.";
}
