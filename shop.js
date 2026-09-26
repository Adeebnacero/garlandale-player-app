// Club shop page (shop.html). Browsing, cart, checkout, order history.
//
// Screens are switched with the URL hash so the phone's back button works:
//   #            shop          #p/<id>   product      #cart      cart
//   #checkout    checkout      #orders   My orders    #o/<id>    one order
//   #policy      store policy  #confirm/<id>  after returning from Yoco
//
// The cart is kept on this device (localStorage, per logged-in user) and
// only ever holds product/size ids and quantities. Prices and stock are
// always re-checked by the server at checkout (create-store-checkout).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { cachedFetch } from './cache.js';
import {
  registerServiceWorker, setupDrawer, setupRefreshAndSignOut, loadNoticeBadge, loadActiveStatus,
  loadMyPlayers, resolveSelectedPlayer, getSessionOrTimeout, showSessionCheckError,
  escapeHtml, escapeAttr, linkifyText, updateShopNav, setupNavigationFeedback, startNavigationFeedback,
} from './page-shared.js';

const loading = document.getElementById('loading');
const app = document.getElementById('app');
const $view = document.getElementById('shop-view');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  loading.textContent = 'This app has no Supabase connection configured yet.';
  throw new Error('Missing Supabase config');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let session;
try {
  ({ data: { session } } = await getSessionOrTimeout(supabase));
} catch (err) {
  showSessionCheckError(loading);
  throw err;
}
if (!session) {
  window.location.href = 'index.html';
  throw new Error('Not signed in');
}

const uid = session.user.id;
const token = session.access_token;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const money = (n) => 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const niceDate = (d) => new Date(String(d).length === 10 ? d + 'T00:00:00' : d)
  .toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const ICON_BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 016 0"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const art = (p) => (p && p.photoUrl ? `<img src="${escapeAttr(p.photoUrl)}" alt="" loading="lazy">` : ICON_BAG);
const backLink = (hash, label) => `<button class="shop-back" type="button" data-go="${hash}">${ICON_BACK}${escapeHtml(label)}</button>`;

// Admin fee, in rand. Same rule as the server: worked out in cents, half a
// cent rounds up. The server's figure is what's actually charged.
function adminFee(subtotal, percent) {
  const cents = Math.round(Number(subtotal) * 100);
  if (!(cents > 0) || !(percent > 0)) return 0;
  return Math.round((cents * percent) / 100) / 100;
}

function toast(msg) {
  const t = document.getElementById('shop-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
  } catch {
    throw new Error('Couldn’t reach the club’s server. Check your connection and try again.');
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok) throw new Error((body && body.error) || 'Something went wrong. Check your connection and try again.');
  return body;
}

// ---------------------------------------------------------------------------
// Cart (this device only)
// ---------------------------------------------------------------------------
const CART_KEY = `gfc_shop_cart_${uid}`;
const DETAILS_KEY = `gfc_shop_details_${uid}`;

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

let cart = readJSON(CART_KEY, []).filter((l) => l && typeof l.productId === 'string' && Number.isInteger(l.qty));
const saveCart = () => { writeJSON(CART_KEY, cart); updateCartBadge(); };

function updateCartBadge() {
  const n = cart.reduce((a, l) => a + l.qty, 0);
  const badge = document.getElementById('cart-count');
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let shop = null;          // response from get-shop
let shopError = '';
let orders = null;        // response from get-my-orders, loaded when needed
let ordersError = '';
let flash = '';           // one-off message shown at the top of the next screen
let detailSel = { productId: null, sizeId: null, qty: 1 };
let form = null;          // checkout form values
let formErrors = {};
let paying = false;
// Guardian's name and phone from the linked player's record, used to
// pre-fill checkout the first time (later orders reuse what they typed).
const profileDefaults = { name: '', phone: '' };

const productById = (id) => (shop && shop.products ? shop.products.find((p) => p.id === id) : null);
function sizeOf(p, sizeId) { return p && p.hasSizes ? p.sizes.find((s) => s.id === sizeId) || null : null; }
function maxQtyFor(p, sizeId) {
  if (!p) return 0;
  if (p.saleMode === 'preorder') return 10;
  if (p.hasSizes) { const s = sizeOf(p, sizeId); return s ? s.maxQty : 0; }
  return p.maxQty || 0;
}
const inCart = (productId, sizeId) => cart.filter((l) => l.productId === productId && (l.sizeId || null) === (sizeId || null)).reduce((a, l) => a + l.qty, 0);
const cartLines = () => cart.map((l) => ({ ...l, product: productById(l.productId) })).filter((l) => l.product);
const cartSubtotal = () => cartLines().reduce((a, l) => a + l.qty * l.product.price, 0);

// Drops cart lines that can no longer be bought and trims quantities to
// what's available. Returns a message if anything changed.
function reconcileCart() {
  if (!shop || !shop.open) return '';
  const changes = [];
  const next = [];
  for (const l of cart) {
    const p = productById(l.productId);
    const size = p && p.hasSizes ? sizeOf(p, l.sizeId) : null;
    const label = p ? p.name + (size ? ` (${size.label})` : '') : 'An item';
    if (!p || (p.hasSizes && !size) || (!p.hasSizes && l.sizeId)) { changes.push(`${label} is no longer available`); continue; }
    const max = maxQtyFor(p, l.sizeId);
    if (max <= 0) { changes.push(`${label} has sold out`); continue; }
    if (l.qty > max) { changes.push(`${label}: only ${max} available`); next.push({ ...l, qty: max }); continue; }
    next.push(l);
  }
  if (changes.length) { cart = next; saveCart(); }
  return changes.length ? `Your cart was updated: ${changes.join('; ')}.` : '';
}

const STATUS_TEXT = {
  paid: 'Being prepared', preorder: 'Pre-order placed', supplier: 'Ordered from supplier',
  ready: 'Ready for collection', collected: 'Collected', refunded: 'Refunded',
};
function lineGroupStatus(lines) {
  // For display: a paid pre-order line reads "Pre-order placed" rather
  // than "Being prepared", since nothing happens until pre-orders close.
  const s = lines[0].status;
  return s === 'paid' && lines[0].isPreorder ? 'preorder' : s;
}
function orderListStatus(o) {
  if (o.status === 'paid' && o.lines.every((l) => l.isPreorder || l.status === 'refunded')) return 'preorder';
  return o.status;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function tabs(active) {
  return `<div class="shop-segmented" role="tablist">
    <button type="button" role="tab" aria-selected="${active === 'shop'}" class="${active === 'shop' ? 'on' : ''}" data-go="#">Shop</button>
    <button type="button" role="tab" aria-selected="${active === 'orders'}" class="${active === 'orders' ? 'on' : ''}" data-go="#orders">My orders</button>
  </div>`;
}
const flashHtml = () => {
  if (!flash) return '';
  const html = `<div class="shop-alert ${flash.startsWith('!') ? 'bad' : 'warn'}" role="status">${escapeHtml(flash.replace(/^!/, ''))}</div>`;
  flash = '';
  return html;
};

function availability(p) {
  if (p.state === 'preorder') return { cls: 'preorder', text: p.preorderClosesOn ? `Pre-order · closes ${niceDate(p.preorderClosesOn).replace(/ \d{4}$/, '')}` : 'Pre-order' };
  if (p.state === 'out') return { cls: 'out', text: 'Sold out' };
  if (p.state === 'low') return { cls: 'low', text: p.left ? `Only ${p.left} left` : 'Few left' };
  return { cls: 'in', text: 'In stock' };
}

function viewShop() {
  if (shopError) return `<h1>Club shop</h1>${tabs('shop')}<div class="shop-alert bad">${escapeHtml(shopError)}</div><button class="shop-btn-line" type="button" data-reload>Try again</button>`;
  if (!shop) return `<h1>Club shop</h1>${tabs('shop')}<p class="shop-muted"><span class="spinner-inline" aria-hidden="true"></span>Loading the shop…</p>`;
  if (!shop.open) {
    return `<h1>Club shop</h1>${tabs('shop')}${flashHtml()}
      <div class="shop-empty">${ICON_BAG}<h2>The shop is closed</h2><p>The club shop isn’t open at the moment. Your past orders are still under My orders.</p></div>`;
  }
  const products = shop.products || [];
  return `
    <h1>Club shop</h1>
    <p class="shop-intro">Order online, collect at the clubhouse.</p>
    ${tabs('shop')}
    ${flashHtml()}
    ${products.length ? `<div class="product-grid">${products.map((p) => {
      const a = availability(p);
      return `<button class="product-tile${p.state === 'out' ? ' is-soldout' : ''}" type="button" data-go="#p/${p.id}">
        <div class="product-art">${art(p)}</div>
        <div class="product-tile-body">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <p class="product-price">${money(p.price)}</p>
          <span class="avail ${a.cls}">${a.text}</span>
        </div>
      </button>`;
    }).join('')}</div>` : `<div class="shop-empty">${ICON_BAG}<h2>Nothing for sale right now</h2><p>Check back soon.</p></div>`}
    <p class="shop-note shop-center"><button class="shop-link" type="button" data-go="#policy">Store policy</button></p>`;
}

function viewProduct(id) {
  const p = productById(id);
  if (!p) return `${backLink('#', 'Shop')}<div class="shop-empty"><h2>This item isn’t available</h2><p>It may have sold out or been removed from the shop.</p><button class="shop-btn-gold" type="button" data-go="#">Back to the shop</button></div>`;
  if (detailSel.productId !== p.id) detailSel = { productId: p.id, sizeId: null, qty: 1 };
  const a = availability(p);
  const size = sizeOf(p, detailSel.sizeId);
  const needSize = p.hasSizes && !size;
  const room = needSize ? 0 : Math.max(0, maxQtyFor(p, detailSel.sizeId) - inCart(p.id, detailSel.sizeId));
  const qty = Math.max(1, Math.min(detailSel.qty, Math.max(room, 1)));
  let hint = '';
  if (size && p.saleMode === 'stock') {
    if (room === 0) hint = `You already have all available ${escapeHtml(size.label)} in your cart`;
    else if (size.state === 'low' && size.left) hint = `Only ${size.left} left in ${escapeHtml(size.label)}`;
  } else if (!p.hasSizes && p.saleMode === 'stock' && p.state !== 'out' && room === 0) {
    hint = 'You already have all available stock in your cart';
  }
  const canAdd = p.state !== 'out' && !needSize && room > 0;
  const label = p.state === 'out' ? 'Sold out' : needSize ? 'Choose a size' : room === 0 ? 'All available stock is in your cart' : p.saleMode === 'preorder' ? 'Add pre-order to cart' : 'Add to cart';
  return `
    ${backLink('#', 'Shop')}
    <div class="detail-art">${art(p)}</div>
    <p class="detail-name">${escapeHtml(p.name)}</p>
    <p class="detail-price">${money(p.price)}</p>
    <span class="avail ${a.cls}">${a.text}</span>
    ${p.description ? `<p class="detail-desc">${linkifyText(p.description)}</p>` : '<div style="height:18px"></div>'}
    ${p.saleMode === 'preorder' ? `<div class="preorder-box"><strong>Pre-order</strong>${p.preorderClosesOn ? `Orders close ${niceDate(p.preorderClosesOn)}. ` : ''}${p.preorderExpected ? escapeHtml(p.preorderExpected) + '. ' : ''}You pay now, and we’ll show it as ready to collect under My orders when it arrives.</div>` : ''}
    ${p.hasSizes ? `
      <p class="shop-field-label">Size</p>
      <div class="size-row">${p.sizes.map((s) => `<button type="button" class="size-chip${detailSel.sizeId === s.id ? ' on' : ''}" data-size="${s.id}" ${s.state === 'out' ? `disabled aria-label="${escapeAttr(s.label)}, sold out"` : `aria-pressed="${detailSel.sizeId === s.id}"`}>${escapeHtml(s.label)}</button>`).join('')}</div>
      <p class="size-hint">${hint}</p>` : `<p class="size-hint" style="margin-top:0">${hint}</p>`}
    ${p.state !== 'out' ? `
      <p class="shop-field-label">Quantity</p>
      <div class="qty" style="margin-bottom:22px">
        <button type="button" data-dq="-1" aria-label="Fewer" ${qty <= 1 ? 'disabled' : ''}>−</button>
        <output aria-live="polite">${qty}</output>
        <button type="button" data-dq="1" aria-label="More" ${qty >= room ? 'disabled' : ''}>+</button>
      </div>` : ''}
    <button class="shop-btn-gold" type="button" data-add ${canAdd ? '' : 'disabled'}>${label}</button>`;
}

function totalsHtml(subtotal) {
  const pct = shop ? shop.adminFeePercent : 0;
  const fee = adminFee(subtotal, pct);
  return `
    <div class="sum-row"><span>Items</span><span>${money(subtotal)}</span></div>
    ${fee > 0 ? `<div class="sum-row"><span>Admin fee (${pct}%)</span><span>${money(fee)}</span></div>` : ''}
    <div class="sum-row"><span>Collection at the clubhouse</span><span>Free</span></div>
    <div class="sum-row total"><span>Total</span><span>${money(subtotal + fee)}</span></div>`;
}

function viewCart() {
  const note = flashHtml();
  const lines = cartLines();
  if (!lines.length) {
    return `${backLink('#', 'Shop')}<h1>Your cart</h1>${note}
      <div class="shop-empty">${ICON_BAG}<h2>Your cart is empty</h2><p>Add kit and supporters’ gear from the club shop.</p>
      <button class="shop-btn-gold" type="button" data-go="#">Browse the shop</button></div>`;
  }
  const hasPre = lines.some((l) => l.product.saleMode === 'preorder');
  const hasStock = lines.some((l) => l.product.saleMode === 'stock');
  return `
    ${backLink('#', 'Keep shopping')}
    <h1>Your cart</h1>
    ${note}
    <div class="card" style="padding:4px 18px">
      ${lines.map((l, i) => {
        const size = sizeOf(l.product, l.sizeId);
        const max = maxQtyFor(l.product, l.sizeId);
        return `<div class="cart-line">
          <div class="cart-thumb">${art(l.product)}</div>
          <div>
            <h3>${escapeHtml(l.product.name)}${l.product.saleMode === 'preorder' ? '<span class="tag-pre">Pre-order</span>' : ''}</h3>
            <p class="cart-meta">${size ? `Size ${escapeHtml(size.label)} · ` : ''}${money(l.product.price)} each</p>
            <div class="qty">
              <button type="button" data-cq="${i}:-1" aria-label="Fewer" ${l.qty <= 1 ? 'disabled' : ''}>−</button>
              <output>${l.qty}</output>
              <button type="button" data-cq="${i}:1" aria-label="More" ${l.qty >= max ? 'disabled' : ''}>+</button>
            </div>
          </div>
          <div>
            <div class="line-total">${money(l.qty * l.product.price)}</div>
            <button class="remove-btn" type="button" data-remove="${i}">Remove</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="card" style="padding:16px 18px">${totalsHtml(cartSubtotal())}</div>
    ${hasPre && hasStock ? '<div class="shop-alert warn">Your in-stock items can be collected as soon as they’re ready. Pre-order items are collected separately when they arrive.</div>' : ''}
    <button class="shop-btn-gold" type="button" data-go="#checkout">Checkout</button>`;
}

function defaultForm() {
  const saved = readJSON(DETAILS_KEY, null);
  return {
    name: saved?.name || profileDefaults.name || '',
    phone: saved?.phone || profileDefaults.phone || '',
    email: saved?.email || session.user.email || '',
    agreed: false,
  };
}

function viewCheckout() {
  const lines = cartLines();
  if (!lines.length) return viewCart();
  if (!form) form = defaultForm();
  const e = formErrors;
  const subtotal = cartSubtotal();
  const total = subtotal + adminFee(subtotal, shop.adminFeePercent);
  return `
    ${backLink('#cart', 'Cart')}
    <h1>Checkout</h1>
    ${flashHtml()}
    <div class="card" style="padding:18px">
      <p class="card-label">Your details</p>
      <div class="shop-form-field"><label for="f-name">Full name</label><input id="f-name" data-f="name" value="${escapeAttr(form.name)}" autocomplete="name" maxlength="120">${e.name ? `<div class="err">${e.name}</div>` : ''}</div>
      <div class="shop-form-field"><label for="f-phone">Cellphone</label><input id="f-phone" data-f="phone" value="${escapeAttr(form.phone)}" inputmode="tel" autocomplete="tel" maxlength="16">${e.phone ? `<div class="err">${e.phone}</div>` : ''}</div>
      <div class="shop-form-field" style="margin-bottom:0"><label for="f-email">Email</label><input id="f-email" data-f="email" value="${escapeAttr(form.email)}" inputmode="email" autocomplete="email" maxlength="200">${e.email ? `<div class="err">${e.email}</div>` : ''}</div>
      <p class="shop-note" style="margin-top:10px">The club uses these details to contact you about this order.</p>
    </div>
    <div class="card" style="padding:16px 18px">
      <p class="card-label">Order summary</p>
      ${lines.map((l) => { const s = sizeOf(l.product, l.sizeId); return `<div class="sum-row"><span>${l.qty} × ${escapeHtml(l.product.name)}${s ? ` (${escapeHtml(s.label)})` : ''}</span><span>${money(l.qty * l.product.price)}</span></div>`; }).join('')}
      <div style="border-top:1px solid var(--line); margin-top:8px; padding-top:6px">${totalsHtml(subtotal)}</div>
    </div>
    <div class="card" style="padding:16px 18px">
      <p class="card-label">Collection</p>
      <p style="margin:0; font-size:13.5px; line-height:1.5">Collect at the Garlandale FC clubhouse. Your order shows as ready for collection under My orders. Bring your order number.</p>
    </div>
    <label class="shop-check"><input type="checkbox" data-f="agreed" ${form.agreed ? 'checked' : ''}><span>I’ve read the <button class="shop-link" type="button" data-go="#policy">store policy</button>, including returns and refunds.</span></label>
    ${e.agreed ? `<div class="shop-alert bad" style="margin-top:-8px">${e.agreed}</div>` : ''}
    <button class="shop-btn-gold" type="button" data-pay ${paying ? 'disabled' : ''}>${paying ? 'Opening secure payment…' : `Pay ${money(total)} with Yoco`}</button>
    <p class="shop-note shop-center">You’ll pay on Yoco’s secure page. The club never sees your card details.</p>`;
}

function stepsHtml(lines) {
  const pre = lines[0].isPreorder;
  const s = lines[0].status;
  if (s === 'refunded') return '';
  const flow = pre ? ['paid', 'supplier', 'ready', 'collected'] : ['paid', 'ready', 'collected'];
  const labels = { paid: 'Paid', supplier: 'Ordered from supplier', ready: 'Ready for collection', collected: 'Collected' };
  const at = flow.indexOf(s);
  return `<ol class="steps">${flow.map((k, i) => `<li class="${i <= at ? 'done' : ''}"><div><b>${labels[k]}</b></div></li>`).join('')}</ol>`;
}

function viewOrders() {
  let body;
  if (ordersError) body = `<div class="shop-alert bad">${escapeHtml(ordersError)}</div><button class="shop-btn-line" type="button" data-reload-orders>Try again</button>`;
  else if (!orders) body = '<p class="shop-muted"><span class="spinner-inline" aria-hidden="true"></span>Loading your orders…</p>';
  else if (!orders.length) body = `<div class="shop-empty">${ICON_BAG}<h2>No orders yet</h2><p>Orders you place in the shop appear here.</p></div>`;
  else body = orders.map((o) => {
    const st = orderListStatus(o);
    const items = o.lines.reduce((a, l) => a + l.quantity, 0);
    return `<button class="order-row" type="button" data-go="#o/${o.id}">
      <span class="num">${escapeHtml(o.orderNumber)}</span><span class="amt">${money(o.total)}</span>
      <span class="sub">${niceDate(o.paidAt)} · ${items} item${items === 1 ? '' : 's'}</span><span class="order-status ${st}">${STATUS_TEXT[st]}</span>
    </button>`;
  }).join('');
  return `<h1>Club shop</h1><p class="shop-intro">Order online, collect at the clubhouse.</p>${tabs('orders')}${flashHtml()}${body}`;
}

function viewOrder(id) {
  if (!orders) return `${backLink('#orders', 'My orders')}<p class="shop-muted"><span class="spinner-inline" aria-hidden="true"></span>Loading…</p>`;
  const o = orders.find((x) => x.id === id);
  if (!o) return `${backLink('#orders', 'My orders')}<div class="shop-empty"><h2>Order not found</h2></div>`;
  const groups = [
    ['In-stock items', o.lines.filter((l) => !l.isPreorder)],
    ['Pre-order items', o.lines.filter((l) => l.isPreorder)],
  ].filter((g) => g[1].length);
  const open = !['collected', 'refunded'].includes(o.status);
  return `
    ${backLink('#orders', 'My orders')}
    <h1 style="margin-bottom:6px">${escapeHtml(o.orderNumber)}</h1>
    <p class="shop-muted" style="margin:0 0 18px; font-size:13.5px">Paid ${niceDate(o.paidAt)} · ${money(o.total)}</p>
    ${open ? `<div class="collect-code"><small>Show this at the clubhouse to collect</small><strong>${escapeHtml(o.orderNumber)}</strong></div>` : ''}
    ${groups.map(([title, lines]) => {
      const st = lineGroupStatus(lines);
      return `<div class="card" style="padding:16px 18px">
        <p class="group-title">${groups.length > 1 ? title : 'Items'}<span class="order-status ${st}">${STATUS_TEXT[st]}</span></p>
        ${lines.map((l) => `<div class="sum-row"><span>${l.quantity} × ${escapeHtml(l.name)}${l.size ? ` (${escapeHtml(l.size)})` : ''}</span><span>${money(l.quantity * l.unitPrice)}</span></div>`).join('')}
        <div style="margin-top:14px">${stepsHtml(lines)}</div>
      </div>`;
    }).join('')}
    <div class="card" style="padding:16px 18px">
      <p class="card-label">Payment</p>
      <div class="sum-row"><span>Items</span><span>${money(o.subtotal)}</span></div>
      ${o.adminFee > 0 ? `<div class="sum-row"><span>Admin fee (${o.adminFeePercent}%)</span><span>${money(o.adminFee)}</span></div>` : ''}
      <div class="sum-row total"><span>Paid</span><span>${money(o.total)}</span></div>
      ${o.refundedTotal > 0 ? `<div class="sum-row" style="color:var(--danger); font-weight:700"><span>Refunded</span><span>${money(o.refundedTotal)}</span></div>` : ''}
    </div>
    <div class="card" style="padding:16px 18px">
      <p class="card-label">Ordered by</p>
      <p style="margin:0; font-size:13.5px; line-height:1.6">${escapeHtml(o.guardian.name)}<br>${escapeHtml(o.guardian.phone)}<br>${escapeHtml(o.guardian.email)}</p>
    </div>
    <p class="shop-note shop-center">Questions about this order? ${shop && (shop.contactEmail || shop.contactPhone) ? `Contact the club on ${escapeHtml([shop.contactEmail, shop.contactPhone].filter(Boolean).join(' or '))}` : 'Contact the club'} and quote your order number.</p>`;
}

function viewPolicy() {
  const back = sessionStorage.getItem('gfc_shop_policy_back') || '#';
  if (!shop || !shop.open) return `${backLink(back, 'Back')}<h1>Store policy</h1><p class="shop-muted">The shop is closed at the moment.</p>`;
  const sections = String(shop.policyText || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    const lines = b.split('\n');
    return lines.length > 1 ? { heading: lines[0].trim(), body: lines.slice(1).join('\n').trim() } : { heading: '', body: lines[0].trim() };
  });
  const contact = [shop.contactEmail, shop.contactPhone].filter(Boolean).join(' · ');
  return `
    ${backLink(back, back === '#checkout' ? 'Checkout' : 'Back')}
    <h1>Store policy</h1>
    <div class="shop-policy">
      ${sections.map((s) => `${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''}<p>${linkifyText(s.body)}</p>`).join('')}
      ${shop.adminFeePercent > 0 ? `<h2>Admin fee</h2><p>An admin fee of ${shop.adminFeePercent}% of the order value is added at checkout to cover card processing costs. It’s shown in your cart before you pay.</p>` : ''}
      ${contact ? `<h2>Contact</h2><p>${linkifyText(contact)}</p>` : ''}
    </div>`;
}

// After Yoco sends the guardian back. The payment is confirmed by Yoco's
// webhook, usually within a few seconds, so wait for it here.
let confirmState = { id: null, status: 'waiting', order: null };
function viewConfirm(id) {
  if (confirmState.id !== id) { confirmState = { id, status: 'waiting', order: null }; pollPayment(id); }
  if (confirmState.status === 'waiting') {
    return `<div class="shop-center"><div class="shop-spinner" role="status" aria-label="Confirming payment"></div>
      <p style="font-weight:700; font-size:17px; margin:0 0 4px">Confirming your payment…</p>
      <p class="shop-muted" style="font-size:13.5px">This usually takes a few seconds. Please don’t pay again.</p></div>`;
  }
  if (confirmState.status === 'slow') {
    return `<div class="shop-center"><p style="font-weight:700; font-size:17px; margin:24px 0 6px">We’re still confirming your payment</p>
      <p class="shop-muted" style="font-size:13.5px; line-height:1.5">If Yoco showed your payment as successful, your order will appear under My orders shortly. Please don’t pay again.</p></div>
      <button class="shop-btn-gold" type="button" data-go="#orders">Go to My orders</button>`;
  }
  const o = confirmState.order;
  const hasPre = o.lines.some((l) => l.isPreorder);
  return `
    <div class="success-mark">${ICON_TICK}</div>
    <p class="shop-center" style="font-weight:700; font-size:17px; margin:0 0 4px">Payment received</p>
    <p class="shop-center shop-muted" style="margin:0 0 14px; font-size:13.5px">Your order number is</p>
    <p class="order-number">${escapeHtml(o.orderNumber)}</p>
    <p class="shop-center shop-muted" style="margin:0 0 20px; font-size:13px">${money(o.total)} paid. You’ll find this order under My orders.</p>
    <div class="card" style="padding:16px 18px">
      <p class="card-label">What happens next</p>
      <ol class="steps">
        <li class="done"><div><b>Paid</b><span>${money(o.total)} received</span></div></li>
        ${hasPre ? '<li><div><b>Ordered from supplier</b><span>Pre-order items are ordered when pre-orders close</span></div></li>' : ''}
        <li><div><b>Ready for collection</b><span>Shown under My orders</span></div></li>
        <li><div><b>Collected</b><span>Show your order number at the clubhouse</span></div></li>
      </ol>
    </div>
    <button class="shop-btn-gold" type="button" data-go="#o/${o.id}">View order</button>
    <button class="shop-btn-line" type="button" data-go="#">Back to the shop</button>`;
}

async function pollPayment(id) {
  for (let i = 0; i < 15; i++) {
    try {
      const r = await api(`get-my-orders?order_id=${encodeURIComponent(id)}`);
      if (r.paymentStatus === 'paid' && r.order) {
        confirmState = { id, status: 'paid', order: r.order };
        orders = null; // reload the list next time
        render();
        return;
      }
    } catch { /* keep trying */ }
    await new Promise((res) => setTimeout(res, 2000));
    if (confirmState.id !== id) return;
  }
  confirmState = { id, status: 'slow', order: null };
  render();
}

// ---------------------------------------------------------------------------
// Rendering and navigation
// ---------------------------------------------------------------------------
function route() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return { name: 'shop' };
  if (h.startsWith('p/')) return { name: 'product', id: h.slice(2) };
  if (h.startsWith('o/')) return { name: 'order', id: h.slice(2) };
  if (h.startsWith('confirm/')) return { name: 'confirm', id: h.slice(8) };
  if (['cart', 'checkout', 'orders', 'policy'].includes(h)) return { name: h };
  return { name: 'shop' };
}

function render() {
  const r = route();
  if ((r.name === 'orders' || r.name === 'order') && orders === null && !ordersError) loadOrders();
  // Screens that need the shop's products wait for them, so a message
  // (e.g. "Payment cancelled") isn't shown and used up on an empty screen.
  if (!shop && !shopError && ['product', 'cart', 'checkout', 'policy'].includes(r.name)) {
    $view.innerHTML = '<p class="shop-muted"><span class="spinner-inline" aria-hidden="true"></span>Loading the shop…</p>';
    updateCartBadge();
    return;
  }
  const html = {
    shop: viewShop, product: () => viewProduct(r.id), cart: viewCart, checkout: viewCheckout,
    orders: viewOrders, order: () => viewOrder(r.id), policy: viewPolicy, confirm: () => viewConfirm(r.id),
  }[r.name]();
  $view.innerHTML = html;
  updateCartBadge();
}

function go(hash) {
  if (hash === '#policy') sessionStorage.setItem('gfc_shop_policy_back', location.hash || '#');
  const target = hash === '#' ? location.pathname : hash;
  if ((location.hash || '#') === hash) { render(); return; }
  history.pushState(null, '', target);
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => { render(); window.scrollTo(0, 0); });

async function loadShop() {
  try {
    shop = await api('get-shop');
    shopError = '';
    const changed = reconcileCart();
    if (changed) flash = flash ? `${flash} ${changed}` : changed;
  } catch (err) {
    shopError = err.message;
  }
  render();
}

async function loadOrders() {
  ordersError = '';
  try {
    orders = (await api('get-my-orders')).orders || [];
  } catch (err) {
    ordersError = err.message;
    orders = null;
  }
  render();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
$view.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.go) { go(t.dataset.go); return; }
  if (t.hasAttribute('data-reload')) { shopError = ''; shop = null; render(); loadShop(); return; }
  if (t.hasAttribute('data-reload-orders')) { ordersError = ''; orders = null; render(); return; }
  if (t.dataset.size) { detailSel.sizeId = t.dataset.size; detailSel.qty = 1; render(); return; }
  if (t.dataset.dq) { detailSel.qty = Math.max(1, detailSel.qty + Number(t.dataset.dq)); render(); return; }
  if (t.hasAttribute('data-add')) {
    const p = productById(detailSel.productId);
    if (!p) return;
    const sizeId = p.hasSizes ? detailSel.sizeId : null;
    const room = maxQtyFor(p, sizeId) - inCart(p.id, sizeId);
    const qty = Math.min(detailSel.qty, room);
    if (qty <= 0) return;
    const line = cart.find((l) => l.productId === p.id && (l.sizeId || null) === sizeId);
    if (line) line.qty += qty; else cart.push({ productId: p.id, sizeId, qty });
    saveCart();
    detailSel.qty = 1;
    const size = sizeOf(p, sizeId);
    render();
    toast(`Added ${qty} × ${p.name}${size ? ` (${size.label})` : ''}`);
    return;
  }
  if (t.dataset.cq) {
    const [i, d] = t.dataset.cq.split(':').map(Number);
    const lines = cartLines();
    const l = lines[i];
    if (!l) return;
    const target = cart.find((c) => c.productId === l.productId && (c.sizeId || null) === (l.sizeId || null));
    target.qty = Math.min(Math.max(1, target.qty + d), maxQtyFor(l.product, l.sizeId));
    saveCart(); render(); return;
  }
  if (t.dataset.remove) {
    const l = cartLines()[Number(t.dataset.remove)];
    if (!l) return;
    cart = cart.filter((c) => !(c.productId === l.productId && (c.sizeId || null) === (l.sizeId || null)));
    saveCart(); render(); toast(`Removed ${l.product.name}`); return;
  }
  if (t.hasAttribute('data-pay')) { await pay(); }
});

$view.addEventListener('input', (e) => {
  const k = e.target.dataset.f;
  if (!k || !form) return;
  form[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (formErrors[k]) { formErrors = { ...formErrors, [k]: '' }; }
});
$view.addEventListener('change', (e) => {
  if (e.target.dataset.f === 'agreed' && form) form.agreed = e.target.checked;
});

document.getElementById('cart-btn').addEventListener('click', () => go('#cart'));

async function pay() {
  if (paying) return;
  const errors = {};
  const name = form.name.trim(), phone = form.phone.trim(), email = form.email.trim();
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!/^\+?[0-9 ]{9,16}$/.test(phone)) errors.phone = 'Enter your cellphone number, e.g. 082 555 0142.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!form.agreed) errors.agreed = 'Tick the box to confirm you’ve read the store policy.';
  formErrors = errors;
  if (Object.keys(errors).length) { render(); return; }

  paying = true;
  render();
  try {
    const r = await api('create-store-checkout', {
      method: 'POST',
      body: JSON.stringify({
        items: cartLines().map((l) => ({ productId: l.productId, sizeId: l.sizeId || null, quantity: l.qty })),
        name, phone, email, agreedToPolicy: true,
      }),
    });
    writeJSON(DETAILS_KEY, { name, phone, email });
    sessionStorage.setItem('gfc_shop_pending_order', r.orderId);
    startNavigationFeedback();
    window.location.href = r.redirectUrl;
  } catch (err) {
    paying = false;
    flash = '!' + err.message;
    // Stock or availability may have changed: refresh the shop so the
    // cart reflects it before the guardian tries again.
    await loadShop();
    if (!cartLines().length) go('#cart');
  }
}

// ---------------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------------
loading.style.display = 'none';
app.style.display = 'block';
registerServiceWorker();
setupDrawer();
setupRefreshAndSignOut(supabase, uid);
loadNoticeBadge(SUPABASE_URL, token, uid);
updateShopNav(SUPABASE_URL, token, uid);
setupNavigationFeedback();

// Guardian's name and phone from the linked player's record (loaded
// below), used to pre-fill checkout the first time.
(async () => {
  try {
    const playersBody = await loadMyPlayers(SUPABASE_URL, token, uid);
    const players = playersBody.players || [];
    const playerId = resolveSelectedPlayer(uid, players);
    if (!playerId) return;
    loadActiveStatus(SUPABASE_URL, token, uid, playerId);
    const profile = await cachedFetch(uid, `get-my-profile:${playerId}`, async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-profile?player_id=${encodeURIComponent(playerId)}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load profile');
      return json;
    });
    profileDefaults.name = profile.guardian_name || profile.guardianName || '';
    profileDefaults.phone = profile.guardian_phone || profile.guardianPhone || '';
  } catch { /* pre-fill is a convenience only */ }
})();

// Coming back from Yoco.
const params = new URLSearchParams(location.search);
if (params.get('paid')) {
  const id = params.get('paid');
  cart = []; saveCart();                       // paid: this cart is done
  sessionStorage.removeItem('gfc_shop_pending_order');
  history.replaceState(null, '', `shop.html#confirm/${encodeURIComponent(id)}`);
} else if (params.get('checkout')) {
  flash = params.get('checkout') === 'failed'
    ? '!The payment didn’t go through, so nothing was charged. Your cart is still here. Try again or use a different card.'
    : 'Payment cancelled. Nothing was charged, and your cart is still here.';
  history.replaceState(null, '', 'shop.html#cart');
}

render();
loadShop();
