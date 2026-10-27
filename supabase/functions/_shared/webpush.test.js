// webpush.test.js - run with: deno test supabase/functions/_shared/
//
// Plays the part of the phone: makes a subscription key pair the way a
// browser does, then decrypts what encryptPayload() produced, following
// RFC 8291 from the receiving side. If the two sides disagree on a single
// byte, decryption fails.
import {
  b64urlEncode, b64urlDecode, checkSubscription, encryptPayload,
  importVapidKey, vapidAuthorization, sendPush, MAX_PAYLOAD_BYTES,
} from "./webpush.js";

function assertEquals(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || "assertEquals"}: expected ${expected}, got ${actual}`);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** A browser-style subscription: key pair + auth secret. */
async function fakeBrowser() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    keys, pub, auth,
    sub: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) } },
  };
}

/** The phone's side of RFC 8291. */
async function browserDecrypt(body, browser) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, browser.keys.privateKey, 256));
  const keyInfo = new Uint8Array([...enc.encode("WebPush: info\0"), ...browser.pub, ...asPublic]);
  const ikm = await hkdf(browser.auth, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext));
  // Strip padding back to the delimiter; 0x02 = last record.
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end--;
  if (record[end] !== 2) throw new Error("missing last-record delimiter");
  return { rs, idlen, text: dec.decode(record.slice(0, end)) };
}

/** A VAPID key pair in the same base64url form `npx web-push generate-vapid-keys` prints. */
async function fakeVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d, verifyKey: kp.publicKey };
}

Deno.test("base64url round trip", () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const s = b64urlEncode(bytes);
  assertEquals(/[+/=]/.test(s), false, "url-safe, unpadded");
  assertEquals(b64urlDecode(s).join(","), bytes.join(","), "round trip");
});

Deno.test("the phone can decrypt what we send", async () => {
  const browser = await fakeBrowser();
  const message = JSON.stringify({ title: "Training cancelled", body: "U12 training is off tonight – waterlogged pitch.", url: "notices.html" });
  const body = await encryptPayload(enc.encode(message), browser.sub.keys.p256dh, browser.sub.keys.auth);
  const out = await browserDecrypt(body, browser);
  assertEquals(out.text, message, "plaintext");
  assertEquals(out.rs, 4096, "record size");
  assertEquals(out.idlen, 65, "key id is our public key");
});

Deno.test("every message uses fresh keys, so two sends never look alike", async () => {
  const browser = await fakeBrowser();
  const a = await encryptPayload(enc.encode("same"), browser.sub.keys.p256dh, browser.sub.keys.auth);
  const b = await encryptPayload(enc.encode("same"), browser.sub.keys.p256dh, browser.sub.keys.auth);
  assertEquals(b64urlEncode(a) === b64urlEncode(b), false, "different ciphertext");
});

Deno.test("a different phone can't decrypt it", async () => {
  const browser = await fakeBrowser();
  const other = await fakeBrowser();
  const body = await encryptPayload(enc.encode("private"), browser.sub.keys.p256dh, browser.sub.keys.auth);
  let failed = false;
  try { await browserDecrypt(body, other); } catch { failed = true; }
  assertEquals(failed, true, "wrong keys fail");
});

Deno.test("VAPID token is signed by our key and names the push service", async () => {
  const v = await fakeVapid();
  const signingKey = await importVapidKey(v.publicKey, v.privateKey);
  const now = Date.UTC(2026, 9, 27, 12, 0, 0);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc",
    { publicKey: v.publicKey, signingKey, subject: "mailto:admin@gfcplayers.co.za" }, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assertEquals(!!m, true, "header shape");
  assertEquals(m[4], v.publicKey, "k is our public key");
  const claims = JSON.parse(dec.decode(b64urlDecode(m[2])));
  assertEquals(claims.aud, "https://fcm.googleapis.com", "audience is the push service origin");
  assertEquals(claims.sub, "mailto:admin@gfcplayers.co.za", "subject");
  assertEquals(claims.exp, now / 1000 + 12 * 3600, "12 hour expiry");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.verifyKey,
    b64urlDecode(m[3]), enc.encode(`${m[1]}.${m[2]}`));
  assertEquals(ok, true, "signature verifies");
});

Deno.test("badly formed VAPID keys are refused with a clear message", async () => {
  let msg = "";
  try { await importVapidKey("abc", "def"); } catch (e) { msg = e.message; }
  assertEquals(/generate-vapid-keys/.test(msg), true, "points at the fix");
});

Deno.test("only real push services are accepted", async () => {
  const { sub } = await fakeBrowser();
  const at = (endpoint) => checkSubscription({ ...sub, endpoint });
  assertEquals(at("https://fcm.googleapis.com/fcm/send/x").ok, true, "Chrome");
  assertEquals(at("https://web.push.apple.com/QGx").ok, true, "iPhone");
  assertEquals(at("https://updates.push.services.mozilla.com/wpush/v2/x").ok, true, "Firefox");
  assertEquals(at("https://wns2-par02p.notify.windows.com/w/?token=x").ok, true, "Edge on Windows");
  assertEquals(at("https://example.com/collect").ok, false, "anything else");
  assertEquals(at("https://fcm.googleapis.com.evil.com/x").ok, false, "lookalike host");
  assertEquals(at("http://fcm.googleapis.com/fcm/send/x").ok, false, "not https");
  assertEquals(at("https://fcm.googleapis.com:8443/x").ok, false, "odd port");
  assertEquals(at("https://user:pw@fcm.googleapis.com/x").ok, false, "credentials in URL");
  assertEquals(at("not a url").ok, false, "garbage");
});

Deno.test("subscription keys must be the right shape", async () => {
  const { sub } = await fakeBrowser();
  assertEquals(checkSubscription(sub).ok, true, "good");
  assertEquals(checkSubscription(null).ok, false, "missing");
  assertEquals(checkSubscription({ endpoint: sub.endpoint }).ok, false, "no keys");
  assertEquals(checkSubscription({ ...sub, keys: { ...sub.keys, auth: b64urlEncode(new Uint8Array(8)) } }).ok, false, "short auth");
  assertEquals(checkSubscription({ ...sub, keys: { ...sub.keys, p256dh: b64urlEncode(new Uint8Array(65)) } }).ok, false, "not a curve point");
});

Deno.test("sendPush: headers, and what each push-service reply means", async () => {
  const browser = await fakeBrowser();
  const v = await fakeVapid();
  const vapid = { publicKey: v.publicKey, subject: "mailto:a@b.co", signingKey: await importVapidKey(v.publicKey, v.privateKey) };
  const row = { endpoint: browser.sub.endpoint, p256dh: browser.sub.keys.p256dh, auth: browser.sub.keys.auth };

  let seen;
  const reply = (status) => async (url, init) => { seen = { url, init }; return new Response("", { status }); };

  let r = await sendPush(row, { title: "Hi" }, vapid, { fetchFn: reply(201), urgency: "high", ttl: 60 });
  assertEquals(r.ok, true, "201 is success");
  assertEquals(seen.url, row.endpoint, "posts to the endpoint");
  assertEquals(seen.init.headers["Content-Encoding"], "aes128gcm", "encoding");
  assertEquals(seen.init.headers.TTL, "60", "ttl");
  assertEquals(seen.init.headers.Urgency, "high", "urgency");
  assertEquals((await browserDecrypt(seen.init.body, browser)).text, JSON.stringify({ title: "Hi" }), "body decrypts");

  r = await sendPush(row, { title: "Hi" }, vapid, { fetchFn: reply(410) });
  assertEquals(r.ok === false && r.gone === true, true, "410 = gone");
  r = await sendPush(row, { title: "Hi" }, vapid, { fetchFn: reply(404) });
  assertEquals(r.gone, true, "404 = gone");
  r = await sendPush(row, { title: "Hi" }, vapid, { fetchFn: reply(429) });
  assertEquals(r.ok === false && r.gone === false, true, "429 = try later, keep it");
  r = await sendPush(row, { title: "Hi" }, vapid, { fetchFn: async () => { throw new Error("offline"); } });
  assertEquals(r.ok === false && r.gone === false, true, "network error keeps it");
  r = await sendPush(row, { title: "x".repeat(MAX_PAYLOAD_BYTES) }, vapid, { fetchFn: reply(201) });
  assertEquals(r.ok, false, "over-long message refused before sending");
});
