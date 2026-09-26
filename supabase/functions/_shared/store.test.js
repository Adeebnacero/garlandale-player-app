// store.test.js
//
// Tests for store.js (club shop helpers). Run with:
//
//   deno test supabase/functions/_shared/
//
// Same zero-dependency style as billing.test.js.

import { shopProductView, parseCheckoutBody, orderStatus, orderView, todayInSA } from "./store.js";

function assertEquals(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "assertEquals"}: expected ${e}, got ${a}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

const BASE = "https://x.supabase.co/storage/v1/object/public/store-photos";
const TODAY = "2026-09-25";

Deno.test("hidden products and closed pre-orders are not shown", () => {
  assertEquals(shopProductView({ visible: false }, TODAY, BASE), null);
  assertEquals(shopProductView({ visible: true, sale_mode: "preorder", preorder_closes_on: "2026-09-24" }, TODAY, BASE), null);
  assert(shopProductView({ visible: true, sale_mode: "preorder", preorder_closes_on: "2026-09-25", store_product_sizes: [] }, TODAY, BASE), "closes today is still open");
});

Deno.test("exact stock is only revealed when low", () => {
  const plenty = shopProductView({ id: "1", visible: true, sale_mode: "stock", has_sizes: false, stock: 40, price: "85.00" }, TODAY, BASE);
  assertEquals([plenty.state, plenty.left, plenty.maxQty], ["in", null, 10]);
  const low = shopProductView({ id: "1", visible: true, sale_mode: "stock", has_sizes: false, stock: 2, price: "85" }, TODAY, BASE);
  assertEquals([low.state, low.left, low.maxQty], ["low", 2, 2]);
  const out = shopProductView({ id: "1", visible: true, sale_mode: "stock", has_sizes: false, stock: 0, price: "85" }, TODAY, BASE);
  assertEquals([out.state, out.maxQty], ["out", 0]);
});

Deno.test("sizes are sorted and each has its own state", () => {
  const p = shopProductView({
    id: "j", visible: true, sale_mode: "stock", has_sizes: true, price: "450", photo_path: "j/1.jpg",
    store_product_sizes: [
      { id: "m", label: "M", stock: 12, sort_order: 2 },
      { id: "s", label: "S", stock: 0, sort_order: 1 },
      { id: "l", label: "L", stock: 1, sort_order: 3 },
    ],
  }, TODAY, BASE);
  assertEquals(p.sizes.map((s) => [s.label, s.state, s.left]), [["S", "out", 0], ["M", "in", null], ["L", "low", 1]]);
  assertEquals(p.state, "in");
  assertEquals(p.photoUrl, `${BASE}/j/1.jpg`);
  assertEquals(p.maxQty, null);
});

Deno.test("checkout body is checked", () => {
  const good = { agreedToPolicy: true, name: "Nadia Adams", phone: "082 555 0142", email: "n@x.co",
    items: [{ productId: "a0000000-0000-0000-0000-000000000001", sizeId: null, quantity: 2 }] };
  const r = parseCheckoutBody(good);
  assert(r.ok, "good body accepted");
  assertEquals(r.items, [{ product_id: "a0000000-0000-0000-0000-000000000001", size_id: null, quantity: 2 }]);
  assert(!parseCheckoutBody({ ...good, agreedToPolicy: false }).ok, "policy required");
  assert(!parseCheckoutBody({ ...good, phone: "12" }).ok, "phone checked");
  assert(!parseCheckoutBody({ ...good, items: [] }).ok, "empty cart");
  assert(!parseCheckoutBody({ ...good, items: [{ productId: "x", quantity: 1 }] }).ok, "bad id");
  assert(!parseCheckoutBody({ ...good, items: [{ ...good.items[0], quantity: 11 }] }).ok, "qty max");
  assert(!parseCheckoutBody({ ...good, items: [{ ...good.items[0], quantity: 1.5 }] }).ok, "whole numbers");
  const withPrice = parseCheckoutBody({ ...good, items: [{ ...good.items[0], price: 1 }] });
  assert(withPrice.ok && !("price" in withPrice.items[0]), "a price sent by the phone is dropped, never used");
});

Deno.test("order status reflects its lines", () => {
  assertEquals(orderStatus([{ status: "paid", is_preorder: false }]), "paid");
  assertEquals(orderStatus([{ status: "paid", is_preorder: true }]), "paid");
  assertEquals(orderStatus([{ status: "supplier", is_preorder: true }]), "supplier");
  assertEquals(orderStatus([{ status: "ready" }, { status: "supplier", is_preorder: true }]), "ready");
  assertEquals(orderStatus([{ status: "collected" }, { status: "refunded" }]), "collected");
  assertEquals(orderStatus([{ status: "refunded" }]), "refunded");
});

Deno.test("order view", () => {
  const v = orderView({ id: "o", order_number: "GFC-2026-0001", subtotal: "450.00", admin_fee: "15.75", admin_fee_percent: "3.50", total: "465.75",
    store_order_items: [{ product_name: "Home jersey", size_label: "M", quantity: 1, unit_price: "450.00", is_preorder: false, status: "ready", sort_order: 1 }] });
  assertEquals([v.total, v.adminFee, v.status, v.lines[0].size], [465.75, 15.75, "ready", "M"]);
});

Deno.test("today in South Africa", () => {
  assertEquals(todayInSA(new Date("2026-09-24T22:30:00Z")), "2026-09-25");
  assertEquals(todayInSA(new Date("2026-09-25T21:59:00Z")), "2026-09-25");
});
