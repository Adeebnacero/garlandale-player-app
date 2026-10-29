// Shared club-shop helpers for the Player Portal's Edge Functions
// (get-shop, create-store-checkout, get-my-orders). Pure functions with no
// imports, like billing.js, so they can be unit-tested with:
//
//   deno test supabase/functions/_shared/
//
// Prices, stock checks and the admin fee are NOT decided here: the
// database function store_create_order() re-prices every checkout from
// the database. These helpers only shape what guardians are shown and
// reject obviously malformed requests early.

// Guardians see "Only N left" at or below this; above it, just "In stock".
export const SHOP_LOW_STOCK = 3;
export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Today's date in South Africa, as YYYY-MM-DD. */
export function todayInSA(now = new Date()) {
  // Africa/Johannesburg is UTC+2 with no daylight saving.
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function stockView(stock) {
  const n = Math.max(0, Number(stock) || 0);
  if (n === 0) return { state: "out", left: 0, maxQty: 0 };
  return {
    state: n <= SHOP_LOW_STOCK ? "low" : "in",
    left: n <= SHOP_LOW_STOCK ? n : null,
    maxQty: Math.min(n, MAX_QTY_PER_LINE),
  };
}

/**
 * What guardians may see of one product (row from store_products with
 * store_product_sizes embedded). Returns null if it shouldn't be shown:
 * hidden, or a pre-order whose closing date has passed. Exact stock is
 * only revealed when it's low.
 */
export function shopProductView(row, today, photoBaseUrl) {
  if (!row || !row.visible) return null;
  const pre = row.sale_mode === "preorder";
  if (pre && row.preorder_closes_on && row.preorder_closes_on < today) return null;

  const sizes = (row.store_product_sizes || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s) => {
      const v = pre ? { state: "preorder", left: null, maxQty: MAX_QTY_PER_LINE } : stockView(s.stock);
      return { id: s.id, label: s.label, state: v.state, left: v.left, maxQty: v.maxQty };
    });

  let overall;
  if (pre) overall = { state: "preorder", left: null, maxQty: MAX_QTY_PER_LINE };
  else if (row.has_sizes) {
    const any = sizes.some((s) => s.state !== "out");
    overall = { state: any ? (sizes.every((s) => s.state === "out" || s.state === "low") ? "low" : "in") : "out", left: null, maxQty: 0 };
  } else overall = stockView(row.stock);

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    price: Number(row.price),
    saleMode: pre ? "preorder" : "stock",
    hasSizes: !!row.has_sizes,
    preorderClosesOn: pre ? row.preorder_closes_on || null : null,
    preorderExpected: pre ? row.preorder_expected || "" : "",
    photoUrl: row.photo_path ? `${photoBaseUrl}/${row.photo_path}` : null,
    state: overall.state,           // in | low | out | preorder
    left: overall.left,             // number when low, else null
    maxQty: row.has_sizes ? null : overall.maxQty,
    sizes: row.has_sizes ? sizes : [],
  };
}

/**
 * Checks the body sent by the shop page to create-store-checkout.
 * Returns { ok: true, items, name, phone, email } or { ok: false, error }.
 */
export function parseCheckoutBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  if (body.agreedToPolicy !== true) return { ok: false, error: "Confirm you’ve read the store policy to continue." };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Enter your full name." };
  if (!/^\+?[0-9 ]{9,16}$/.test(phone)) return { ok: false, error: "Enter a valid cellphone number." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { ok: false, error: "Enter a valid email address." };

  if (!Array.isArray(body.items) || body.items.length === 0) return { ok: false, error: "Your cart is empty." };
  if (body.items.length > MAX_LINES) return { ok: false, error: "That’s too many different items for one order. Split it into two orders." };

  const items = [];
  for (const it of body.items) {
    const productId = typeof it?.productId === "string" ? it.productId : "";
    const sizeId = it?.sizeId == null || it.sizeId === "" ? null : typeof it.sizeId === "string" ? it.sizeId : "bad";
    const qty = it?.quantity;
    if (!UUID_RE.test(productId) || (sizeId !== null && !UUID_RE.test(sizeId))) {
      return { ok: false, error: "Something in your cart isn’t valid. Remove it and add it again." };
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      return { ok: false, error: `Quantities must be between 1 and ${MAX_QTY_PER_LINE}.` };
    }
    items.push({ product_id: productId, size_id: sizeId, quantity: qty });
  }
  return { ok: true, items, name, phone, email };
}

/**
 * Overall status of an order from its lines, for the order list:
 * paid (being prepared), supplier, ready, collected, refunded.
 */
export function orderStatus(lines) {
  const ss = lines.map((l) => l.status);
  if (ss.length && ss.every((s) => s === "refunded")) return "refunded";
  if (ss.length && ss.every((s) => s === "collected" || s === "refunded")) return "collected";
  if (ss.includes("ready")) return "ready";
  if (lines.some((l) => l.status === "paid" && !l.is_preorder)) return "paid";
  if (ss.includes("supplier")) return "supplier";
  return "paid";
}

/** Shapes one order (row with store_order_items embedded) for the guardian. */
export function orderView(row) {
  const lines = (row.store_order_items || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((l) => ({
      name: l.product_name,
      size: l.size_label || null,
      quantity: l.quantity,
      unitPrice: Number(l.unit_price),
      isPreorder: !!l.is_preorder,
      status: l.status,
    }));
  return {
    id: row.id,
    orderNumber: row.order_number,
    paidAt: row.paid_at,
    subtotal: Number(row.subtotal),
    adminFee: Number(row.admin_fee),
    adminFeePercent: Number(row.admin_fee_percent),
    total: Number(row.total),
    refundedTotal: Number(row.refunded_total || 0),
    status: orderStatus(lines.map((l) => ({ status: l.status, is_preorder: l.isPreorder }))),
    lines,
    guardian: { name: row.guardian_name, phone: row.guardian_phone, email: row.guardian_email },
  };
}
