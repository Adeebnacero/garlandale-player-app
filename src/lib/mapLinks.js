// ---------------------------------------------------------------------------
// Validation for the optional venue location fields on fixtures, Matchday
// entries and notices. Both fields are shown to guardians in the Player
// Portal, so only genuine Google Maps addresses are accepted:
//
//   Directions link - a Google Maps share link (Share -> Copy link).
//   Map embed       - the map address from Google's embed code
//                     (Share -> Embed a map -> Copy HTML). Staff paste the
//                     whole <iframe ...> snippet; only its src address is
//                     kept. The Player Portal builds its own iframe from
//                     that address, so pasted HTML is never displayed.
//
// The database has matching CHECK constraints (see
// migrations/2026-09-venue-locations.sql), so these rules can't be
// bypassed by writing to the tables directly. The Player Portal also
// re-checks before displaying anything.
// ---------------------------------------------------------------------------

const MAX_LENGTH = 2000;

// Host + path rules for share links. Order doesn't matter.
const LINK_RULES = [
  { host: /^maps\.app\.goo\.gl$/, path: /^\/.+/ },
  { host: /^goo\.gl$/, path: /^\/maps\/.+/ },
  { host: /^(www\.)?google\.(com|co\.za)$/, path: /^\/maps(\/|$)/ },
  { host: /^maps\.google\.(com|co\.za)$/, path: /^\// },
];

const EMBED_HOST = /^(www\.)?google\.com$/;
const EMBED_PATH = /^\/maps\/embed(\/v1\/[a-z]+)?$/;

// Characters that must never appear in a stored address. The database
// constraint rejects the same set.
const UNSAFE_CHARS = /[\s"'<>`\\]/;

const LINK_HELP = "In Google Maps, find the exact spot, tap Share, then Copy link, and paste it here.";
const EMBED_HELP = "In Google Maps, tap Share, then Embed a map, then Copy HTML, and paste the whole code here.";

function toSafeUrl(raw) {
  const s = String(raw || "").trim().replace(/&amp;/g, "&");
  if (!s || s.length > MAX_LENGTH || UNSAFE_CHARS.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (UNSAFE_CHARS.test(u.href)) return null;
  return u;
}

function looksLikeEmbedCode(s) {
  return /<\s*iframe/i.test(s) || /google\.com\/maps\/embed/i.test(s);
}

/**
 * Checks a pasted Directions link.
 * Returns { value } with a cleaned address ("" when left blank),
 * or { error } with a message to show the user.
 */
export function parseMapsLink(raw) {
  const s = String(raw || "").trim();
  if (!s) return { value: "" };
  if (looksLikeEmbedCode(s)) {
    return { error: "That's map embed code. Paste it in the Map embed box instead." };
  }
  const u = toSafeUrl(s);
  if (u && LINK_RULES.some((r) => r.host.test(u.hostname) && r.path.test(u.pathname))) {
    return { value: u.href };
  }
  return { error: `That doesn't look like a Google Maps link. ${LINK_HELP}` };
}

/**
 * Checks pasted map embed code (or just its src address).
 * Returns { value } with the embed address ("" when left blank),
 * or { error } with a message to show the user.
 */
export function parseMapsEmbed(raw) {
  const s = String(raw || "").trim();
  if (!s) return { value: "" };
  let candidate = s;
  if (/<\s*iframe/i.test(s)) {
    const m = s.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    if (!m) return { error: `Couldn't find a map address in that code. ${EMBED_HELP}` };
    candidate = m[2];
  }
  const u = toSafeUrl(candidate);
  if (u && EMBED_HOST.test(u.hostname) && EMBED_PATH.test(u.pathname) && u.search) {
    return { value: u.href };
  }
  if (u && LINK_RULES.some((r) => r.host.test(u.hostname) && r.path.test(u.pathname))) {
    return { error: "That's a share link, not embed code. Paste it in the Directions link box instead." };
  }
  return { error: `That isn't Google Maps embed code. ${EMBED_HELP}` };
}

/**
 * Checks both fields together, for use when a form is submitted.
 * Returns { ok, locationLink, locationEmbed, errors: { link, embed } }.
 */
export function checkLocationFields(form) {
  const link = parseMapsLink(form?.locationLink);
  const embed = parseMapsEmbed(form?.locationEmbed);
  return {
    ok: !link.error && !embed.error,
    locationLink: link.value ?? "",
    locationEmbed: embed.value ?? "",
    errors: { link: link.error || "", embed: embed.error || "" },
  };
}
