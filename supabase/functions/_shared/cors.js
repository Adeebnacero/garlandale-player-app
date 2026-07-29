// Shared CORS helper - lives in supabase/functions/_shared/ like
// rate-limit.js and resolve-player.js, imported via relative path from
// each function's own folder.
//
// WHY THIS EXISTS: every Edge Function used to hard-code
// "Access-Control-Allow-Origin": "*". These endpoints are called with a
// Bearer token rather than cookies, so this isn't classic CSRF - but a
// wildcard origin still means ANY website can call these APIs from a
// visitor's browser if it ever gets hold of that visitor's access token
// (e.g. via a malicious/compromised third-party script, a phishing page
// that tricks someone into pasting a token, or a leaky browser
// extension). Restricting the allowed origin to this app's own domains
// closes that gap while keeping local dev and Vercel preview builds
// working.
//
// Update ALLOWED_ORIGINS if the app ever moves domains again.
const ALLOWED_ORIGINS = [
  "https://www.gfcplayers.co.za",
  "https://gfcplayers.co.za",
  "https://garlandale-player-app.vercel.app", // old domain - safe to remove once fully cut over
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

// Vercel preview deployments for this project look like
// garlandale-player-app-git-<branch>-<team>.vercel.app or
// garlandale-player-app-<hash>.vercel.app. Allow any preview URL of THIS
// specific project (not just any .vercel.app site) so branch previews
// keep working without opening this up to unrelated origins.
const PREVIEW_ORIGIN_RE = /^https:\/\/garlandale-player-app[a-z0-9-]*\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return PREVIEW_ORIGIN_RE.test(origin);
}

/**
 * Builds CORS headers for a single request. Must be called per-request
 * (inside the Deno.serve handler, with the incoming `req`) rather than
 * once at module load, since the correct Access-Control-Allow-Origin
 * value depends on the calling origin.
 *
 * Falls back to the production domain (not a wildcard) for unrecognized
 * origins - the request will still be rejected by the browser's CORS
 * check on the caller's side, which is the point.
 */
export function buildCorsHeaders(req, methods = "GET, OPTIONS") {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
    // Tells any caches/CDNs in front of this function that the response
    // varies by Origin, so they don't serve one origin's CORS headers to
    // a different origin.
    "Vary": "Origin",
  };
}
