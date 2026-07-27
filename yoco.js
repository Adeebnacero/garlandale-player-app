// Shared Yoco helpers - webhook signature verification for incoming
// events (create-yoco-checkout doesn't need a shared helper: it's a
// single POST with a Bearer header, no custom signing).
//
// Yoco's webhook scheme is the same shape as the Svix standard: three
// headers - webhook-id, webhook-timestamp, webhook-signature - and the
// signed content is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256'd with
// the webhook secret (after stripping its "whsec_" prefix) and
// base64-encoded. webhook-signature can list multiple "v1,<sig>" entries
// separated by spaces - only one needs to match.
//
// Docs: https://developer.yoco.com/online/api-reference/webhooks/verifying-events/

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Base64(secretBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
}

/**
 * @param {string} rawBody - the exact raw request body text (must not be
 *   re-serialized JSON - use the literal bytes Yoco sent).
 * @param {{ "webhook-id": string, "webhook-timestamp": string, "webhook-signature": string }} headers
 * @param {string} webhookSecret - starts with "whsec_"
 * @param {{ toleranceSeconds?: number }} [options]
 */
export async function verifyYocoWebhook(rawBody, headers, webhookSecret, options = {}) {
  const { toleranceSeconds = 180 } = options;

  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "missing webhook headers" };
  }

  // Replay-attack guard: reject anything signed too long ago.
  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: "invalid timestamp" };
  const ageSeconds = Math.abs(Date.now() / 1000 - tsSeconds);
  if (ageSeconds > toleranceSeconds) return { ok: false, reason: "timestamp outside tolerance" };

  const secretWithoutPrefix = webhookSecret.startsWith("whsec_")
    ? webhookSecret.slice("whsec_".length)
    : webhookSecret;
  // Yoco's secret is itself base64-encoded before use as the HMAC key.
  const secretBytes = Uint8Array.from(atob(secretWithoutPrefix), (c) => c.charCodeAt(0));

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = await hmacSha256Base64(secretBytes, signedContent);

  const candidates = signatureHeader.split(" ").map((entry) => {
    const commaIdx = entry.indexOf(",");
    return commaIdx === -1 ? entry : entry.slice(commaIdx + 1);
  });

  const matched = candidates.some((sig) => timingSafeEqual(sig, expected));
  return matched ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export const YOCO_API_HOST = "https://payments.yoco.com/api";
