// Shared Web Push sender - lives in supabase/functions/_shared/ like
// rate-limit.js and cors.js.
//
// WHY THIS IS HAND-WRITTEN rather than using the popular `web-push` npm
// package: that package is built on Node's crypto module, which Supabase's
// Deno runtime only partly imitates. Everything here uses the browser-
// standard WebCrypto API instead (the same one Deno, Node and every browser
// ship), so there's nothing that can quietly break on a runtime update.
// It's small because Web Push is only two published standards:
//
//   - VAPID (RFC 8292): a short signed token proving the message comes from
//     the club's server. Signed with the VAPID private key.
//   - Message encryption (RFC 8291, "aes128gcm"): the push service (Google,
//     Apple, Mozilla, Microsoft) relays the message but can't read it. Only
//     the phone holding the subscription's private key can.
//
// webpush.test.js checks both, including decrypting what this produces.
//
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY  base64url, 32-byte P-256 private value
//   VAPID_SUBJECT      mailto: address push services can contact if
//                      something goes wrong, e.g. mailto:admin@gfcplayers.co.za
// `npx web-push generate-vapid-keys` prints a key pair in exactly this form.

const enc = new TextEncoder();

// The push services real browsers use. A subscription endpoint is a URL the
// server later POSTs to, so only these hosts are ever accepted - otherwise a
// signed-in user could register any URL and have the club's server call it.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge (Android), Samsung Internet, Opera
  /^android\.googleapis\.com$/,             // older Chrome
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/,                // Safari / iPhone home-screen apps
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge on Windows
];

// The biggest payload that still fits a single 4096-byte record once the
// encryption header and tag are added. Kept well under to leave headroom.
export const MAX_PAYLOAD_BYTES = 3000;

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------
export function b64urlEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Checking what a browser sends us
// ---------------------------------------------------------------------------

/**
 * Validates a browser's PushSubscription.toJSON(). Returns
 * { ok: true, endpoint, p256dh, auth } or { ok: false, error }.
 */
export function checkSubscription(sub) {
  if (!sub || typeof sub !== "object") return { ok: false, error: "Missing subscription" };
  const endpoint = sub.endpoint;
  const p256dh = sub.keys && sub.keys.p256dh;
  const auth = sub.keys && sub.keys.auth;
  if (typeof endpoint !== "string" || endpoint.length > 2000) return { ok: false, error: "Bad endpoint" };
  let url;
  try { url = new URL(endpoint); } catch { return { ok: false, error: "Bad endpoint" }; }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return { ok: false, error: "Bad endpoint" };
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) return { ok: false, error: "Unrecognised push service" };
  if (typeof p256dh !== "string" || typeof auth !== "string") return { ok: false, error: "Missing keys" };
  let pub, sec;
  try { pub = b64urlDecode(p256dh); sec = b64urlDecode(auth); } catch { return { ok: false, error: "Bad keys" }; }
  if (pub.length !== 65 || pub[0] !== 0x04) return { ok: false, error: "Bad keys" };
  if (sec.length !== 16) return { ok: false, error: "Bad keys" };
  return { ok: true, endpoint, p256dh, auth };
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------------

/** Imports the base64url key pair as a WebCrypto signing key. */
export async function importVapidKey(publicKeyB64, privateKeyB64) {
  const pub = b64urlDecode(publicKeyB64);
  const d = b64urlDecode(privateKeyB64);
  if (pub.length !== 65 || pub[0] !== 0x04 || d.length !== 32) {
    throw new Error("VAPID keys are not in the expected format - regenerate with `npx web-push generate-vapid-keys`");
  }
  return await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)),
      d: b64urlEncode(d),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The Authorization header value for one push service. `aud` is the push
 * service's origin; tokens last 12 hours (the standard allows up to 24).
 */
export async function vapidAuthorization(endpoint, { publicKey, signingKey, subject }, now = Date.now()) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })));
  const unsigned = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is already the raw r||s form JWTs use.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${publicKey}`;
}

// ---------------------------------------------------------------------------
// Encryption (RFC 8291 / RFC 8188, aes128gcm)
// ---------------------------------------------------------------------------

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * Encrypts `plaintext` (Uint8Array) for one subscription. Returns the full
 * request body. `testing` lets the tests supply a fixed salt/key pair; real
 * sends always use fresh random ones.
 */
export async function encryptPayload(plaintext, p256dhB64, authB64, testing = {}) {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);

  const serverKeys = testing.serverKeys ||
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = testing.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // One record: the message, then the 0x02 "last record" delimiter.
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  // Header: salt (16) | record size (uint32, 4096) | key id length (1) | our public key (65)
  const rs = new Uint8Array([0, 0, 0x10, 0]);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Reads VAPID secrets from the environment once per function instance. */
let cachedVapid = null;
export async function vapidFromEnv() {
  if (cachedVapid) return cachedVapid;
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set as Supabase secrets");
  }
  cachedVapid = { publicKey, subject, signingKey: await importVapidKey(publicKey, privateKey) };
  return cachedVapid;
}

/**
 * Sends one message to one subscription row ({ endpoint, p256dh, auth }).
 *
 * message: { title, body, url, tag } - shown by service-worker.js.
 * options: { ttl (seconds the push service may hold it if the phone is
 *            off; default 12h), urgency ('normal' | 'high') }
 *
 * Returns { ok, status, gone } - gone means the subscription no longer
 * exists (phone reset, app removed, permission revoked) and its row should
 * be deleted.
 */
export async function sendPush(sub, message, vapid, { ttl = 12 * 3600, urgency = "normal", fetchFn = fetch } = {}) {
  const payload = enc.encode(JSON.stringify(message));
  if (payload.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 0, gone: false, error: "Message too long" };
  }
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  let res;
  try {
    res = await fetchFn(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
  } catch (err) {
    return { ok: false, status: 0, gone: false, error: String(err && err.message || err) };
  }
  // Drain the body so the connection is released.
  let detail = "";
  try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
    error: res.ok ? undefined : detail,
  };
}

// A subscription that has failed this many times in a row (without a clear
// "gone") is treated as dead and removed.
export const MAX_FAILURES = 5;

/**
 * Sends a batch of deliveries - [{ sub, message, options }] where sub is a
 * push_subscriptions row - a few at a time, and tidies the table as it
 * goes: dead subscriptions are deleted, failures counted, successes
 * stamped. Returns { sent, removed, failed }.
 */
export async function deliver(adminClient, deliveries, { concurrency = 10, vapid = null } = {}) {
  const keys = vapid || await vapidFromEnv();
  const result = { sent: 0, removed: 0, failed: 0 };
  let next = 0;

  async function one({ sub, message, options }) {
    const r = await sendPush(sub, message, keys, options || {});
    if (r.ok) {
      result.sent++;
      await adminClient.from("push_subscriptions")
        .update({ last_sent_at: new Date().toISOString(), failure_count: 0 })
        .eq("id", sub.id);
    } else if (r.gone || (sub.failure_count || 0) + 1 >= MAX_FAILURES) {
      result.removed++;
      await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      result.failed++;
      console.error("push send failed", r.status, r.error);
      await adminClient.from("push_subscriptions")
        .update({ failure_count: (sub.failure_count || 0) + 1 })
        .eq("id", sub.id);
    }
  }

  async function worker() {
    while (next < deliveries.length) {
      const d = deliveries[next++];
      try { await one(d); } catch (err) { result.failed++; console.error("push delivery error", err); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, deliveries.length) }, worker));
  return result;
}

/** Sends `message` to every saved device for one user. Returns { sent, removed, failed }. */
export async function sendToUser(adminClient, authUserId, message, options = {}) {
  const { data: subs, error } = await adminClient
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("auth_user_id", authUserId);
  if (error) throw error;
  return deliver(adminClient, (subs || []).map((sub) => ({ sub, message, options })));
}
