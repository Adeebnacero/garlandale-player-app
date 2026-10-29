import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { T } from "../theme.js";
import { fmtMoney, fmtDate, todayISO } from "../lib/format.js";
import {
  blankProduct, validateProduct, stockSummary, availability, storeStats, adminFee,
  validateSettings, policySections, friendlyStoreError, SIZE_PRESETS, PHOTO_MAX_INPUT_BYTES,
  groupStatus, orderStatus, nextStep, orderStats, supplierSummary, filterOrders, ordersToCsv, parsePrice,
} from "../lib/store.js";
import {
  loadStore, photoUrl, preparePhoto, uploadPhoto, removePhoto, saveProduct,
  deleteProduct, moveProduct, setProductVisible, saveSettings,
  loadOrders, advanceItems, markSupplierOrdered, recordRefund, resolveAttention,
} from "../lib/storeApi.js";

// ---------------------------------------------------------------------------
// Store tab (Club Management): products, sizes, stock, photos, orders,
// admin fee and store policy. Guardians see products in the Player Portal
// shop once the shop is switched on in Store settings.
//
// This tab loads and saves its own data through lib/storeApi.js rather
// than through App.jsx, so the store stays self-contained.
// ---------------------------------------------------------------------------

const STORE_CSS = `
.st-tabs { display: flex; gap: 4px; border-bottom: 2px solid ${T.line}; margin: -6px 0 22px; flex-wrap: wrap; }
.st-tab { background: none; border: 0; padding: 10px 16px; font: 700 13.5px 'Karla', sans-serif; color: ${T.inkSoft}; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.st-tab.on { color: ${T.indigo}; border-bottom-color: ${T.gold}; }
.st-tab:focus-visible, .st-arrow:focus-visible, tr.st-row:focus-visible { outline: 3px solid ${T.gold}; outline-offset: 2px; }
.st-scroll { overflow-x: auto; }
.st-thumb { width: 40px; height: 40px; border-radius: 8px; background: ${T.paperDim}; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; flex: 0 0 auto; margin-right: 10px; }
/* Photos are fitted, never cropped, so staff see exactly what's uploaded. */
.st-thumb img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.st-thumb svg { width: 60%; height: 60%; }
.st-prod { display: flex; align-items: center; font-weight: 700; }
.st-muted { color: ${T.inkSoft}; font-size: 12px; font-weight: 500; }
.st-stock { font-size: 12px; line-height: 1.6; }
.st-stock .zero { color: ${T.danger}; font-weight: 700; }
.st-stock .low { color: ${T.amber}; font-weight: 700; }
.st-money { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; white-space: nowrap; }
.st-switch { position: relative; width: 38px; height: 22px; display: inline-block; flex: 0 0 auto; vertical-align: middle; }
.st-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.st-switch span { position: absolute; inset: 0; background: #d9d1bd; border-radius: 999px; transition: background .15s; cursor: pointer; }
.st-switch span::after { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .15s; }
.st-switch input:checked + span { background: ${T.green}; }
.st-switch input:checked + span::after { transform: translateX(16px); }
.st-switch input:focus-visible + span { outline: 3px solid ${T.gold}; outline-offset: 2px; }
.st-switch input:disabled + span { opacity: .5; cursor: wait; }
@media (prefers-reduced-motion: reduce) { .st-switch span, .st-switch span::after { transition: none; } }
.st-arrows { display: inline-flex; flex-direction: column; gap: 2px; }
.st-arrow { background: none; border: 1px solid ${T.line}; border-radius: 5px; width: 26px; height: 20px; font-size: 10px; color: ${T.indigo}; cursor: pointer; padding: 0; line-height: 1; }
.st-arrow:disabled { opacity: .3; cursor: default; }
.st-radio-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.st-radio { border: 1.5px solid ${T.line}; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-size: 13px; display: flex; gap: 8px; align-items: flex-start; background: #fff; }
.st-radio input { margin-top: 2px; accent-color: ${T.indigo}; }
.st-radio b { display: block; font-size: 13px; }
.st-radio small { color: ${T.inkSoft}; font-size: 11.5px; }
.st-radio.on { border-color: ${T.indigo}; background: #f8f6fc; }
.st-photo { border: 2px dashed #d9d1bd; border-radius: 10px; padding: 12px; display: flex; gap: 12px; align-items: center; background: #faf8f2; margin-bottom: 14px; }
.st-photo .st-thumb { width: 72px; height: 72px; margin: 0; }
.st-sizes { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
.st-sizes th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: ${T.inkSoft}; padding: 4px 6px; }
.st-sizes td { padding: 4px 6px; }
.st-x { background: none; border: 0; color: ${T.danger}; font-size: 18px; cursor: pointer; padding: 0 6px; }
.st-err { color: ${T.danger}; font-size: 12px; font-weight: 700; margin-top: 4px; }
.st-hint { font-size: 11.5px; color: ${T.inkSoft}; margin-top: 4px; }
.st-check { display: flex; gap: 8px; align-items: center; font-size: 13px; margin: 8px 0 12px; cursor: pointer; }
.gfc-modal.st-wide { max-width: 720px; }
.st-policy-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.st-preview { background: #F7F5EF; border: 1px solid ${T.line}; border-radius: 16px; padding: 18px 20px; font-size: 13.5px; line-height: 1.6; max-height: 720px; overflow: auto; }
.st-preview-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: ${T.inkSoft}; font-weight: 700; margin-bottom: 8px; }
.st-preview-title { font-family: 'Anton', sans-serif; font-size: 22px; text-transform: uppercase; margin-bottom: 4px; color: ${T.ink}; }
.st-preview h4 { margin: 14px 0 2px; font-size: 14px; }
.st-preview p { margin: 0; white-space: pre-wrap; }
.st-fee-example { background: #faf8f2; border: 1px solid ${T.line}; border-radius: 10px; padding: 10px 12px; font-size: 12.5px; margin-top: 8px; line-height: 1.6; }
.st-banner { border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.5; margin-bottom: 18px; }
.st-banner.info { background: #ecebf8; color: #3b2f86; }
.st-banner.err { background: ${T.dangerSoft}; color: ${T.danger}; font-weight: 600; }
.st-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: ${T.ink}; color: ${T.paper}; padding: 10px 18px; border-radius: 999px; font: 700 13px 'Karla', sans-serif; z-index: 100; }
tr.st-row { cursor: pointer; }
tr.st-row:hover td { background: ${T.paperDim}; }
.st-filters { display: flex; gap: 10px; flex-wrap: wrap; padding: 14px 16px 0; }
.st-filters .gfc-input, .st-filters .gfc-select { width: auto; min-width: 170px; }
.st-supplier { background: #f8f6fc; border: 1px solid #d9d3ef; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.st-supplier-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
.st-supplier-head b { color: ${T.indigo}; }
.st-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.st-pills span { background: #fff; border: 1px solid #d9d3ef; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
.st-pills b { font-family: 'JetBrains Mono', monospace; margin-left: 4px; }
.st-order-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.st-box { background: #faf8f2; border: 1px solid ${T.line}; border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.6; }
.st-box h4 { margin: 0 0 4px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: ${T.inkSoft}; }
.st-group { border: 1px solid ${T.line}; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
.st-group-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap; }
.st-line { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 3px 0; }
.st-short { color: ${T.danger}; font-weight: 700; font-size: 11.5px; margin-left: 6px; }
.st-history { list-style: none; padding: 0; margin: 0; font-size: 12.5px; }
.st-history li { padding: 6px 0; border-bottom: 1px solid ${T.paperDim}; display: flex; gap: 12px; }
.st-history li:last-child { border-bottom: 0; }
.st-history time { color: ${T.inkSoft}; min-width: 128px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; }
.st-refund { background: ${T.dangerSoft}; border-radius: 10px; padding: 14px; margin-top: 12px; }
.st-refund p { margin: 0 0 10px; font-size: 13px; line-height: 1.5; }
.st-attention { background: ${T.amberSoft}; border: 1px solid #efd9a8; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; font-size: 13px; line-height: 1.5; color: #6e4a07; }
.st-sub-head { font-size: 12.5px; font-weight: 700; color: ${T.indigo}; margin: 18px 0 8px; }
.st-flag { display: inline-block; background: ${T.amberSoft}; color: #8a5a06; border-radius: 999px; font-size: 11px; font-weight: 700; padding: 2px 8px; margin-left: 6px; }
@media (max-width: 640px) { .st-order-grid { grid-template-columns: 1fr; } }
@media (max-width: 980px) { .st-policy-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .st-radio-row { grid-template-columns: 1fr; } }
`;

const NO_PHOTO_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="#b8b09a" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 7" />
  </svg>
);

function Thumb({ src }) {
  return <span className="st-thumb">{src ? <img src={src} alt="" /> : NO_PHOTO_ICON}</span>;
}

function Stat({ color, label, value }) {
  return (
    <div className="gfc-stat">
      <div className="gfc-stat-accent" style={{ background: color }} />
      <div className="gfc-stat-label">{label}</div>
      <div className="gfc-stat-value gfc-mono">{value}</div>
    </div>
  );
}

function AvailabilityBadge({ product, today }) {
  const a = availability(product, today, fmtDate);
  const cls = {
    hidden: "gfc-badge gfc-badge-neutral",
    preorder: "gfc-badge gfc-badge-neutral",
    closed: "gfc-badge gfc-badge-amber",
    soldout: "gfc-badge gfc-badge-red",
    instock: "gfc-badge gfc-badge-green",
  }[a.tone];
  const style = a.tone === "preorder" ? { background: "#ecebf8", color: "#3b2f86" } : undefined;
  return <span className={cls} style={style}>{a.text}</span>;
}

function StockCell({ product }) {
  const s = stockSummary(product);
  if (s.kind === "preorder") return <span className="st-stock st-muted">No stock limit</span>;
  if (s.kind === "single") {
    const p = s.parts[0];
    return <span className="st-stock"><span className={p.level}>{p.stock} in stock</span></span>;
  }
  return (
    <span className="st-stock">
      {s.parts.map((p, i) => (
        <React.Fragment key={p.label}>
          {i > 0 && " · "}
          <span className={p.level}>{p.label}&nbsp;{p.stock}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="st-toast" role="status" aria-live="polite">{message}</div>;
}

/* ================================ Main view ================================ */

export function StoreView({ role }) {
  const [tab, setTab] = useState("products");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(null); // product object, "new", or null
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refresh = useCallback(async () => {
    try {
      const data = await loadStore();
      setProducts(data.products);
      setSettings(data.settings);
      setLoadError("");
    } catch (e) {
      setLoadError(friendlyStoreError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const today = todayISO();
  const stats = useMemo(() => storeStats(products, today), [products, today]);

  async function toggleVisible(p) {
    setBusyId(p.id);
    setActionError("");
    try {
      await setProductVisible(p.id, !p.visible);
      await refresh();
      showToast(!p.visible ? `${p.name} is now shown in the shop` : `${p.name} is now hidden`);
    } catch (e) {
      setActionError(friendlyStoreError(e));
    } finally {
      setBusyId("");
    }
  }

  async function move(p, direction) {
    setBusyId(p.id);
    setActionError("");
    try {
      await moveProduct(p.id, direction);
      await refresh();
    } catch (e) {
      setActionError(friendlyStoreError(e));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <style>{STORE_CSS}</style>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Store</div>
          <div className="gfc-page-sub">Products, orders, admin fee and store policy for the Player Portal shop</div>
        </div>
        {tab === "products" && !loadError && (
          <button className="gfc-btn gfc-btn-primary" onClick={() => setEditing("new")} disabled={loading}>+ Add product</button>
        )}
      </div>

      <div className="st-tabs" role="tablist">
        <button className={`st-tab ${tab === "products" ? "on" : ""}`} role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}>Products</button>
        <button className={`st-tab ${tab === "orders" ? "on" : ""}`} role="tab" aria-selected={tab === "orders"} onClick={() => setTab("orders")}>Orders</button>
        <button className={`st-tab ${tab === "settings" ? "on" : ""}`} role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>Store settings</button>
      </div>

      {loading ? (
        <div className="gfc-empty">Loading the store…</div>
      ) : loadError ? (
        <div className="st-banner err">
          Couldn’t load the store: {loadError}{" "}
          <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => { setLoading(true); refresh(); }}>Try again</button>
        </div>
      ) : tab === "products" ? (
        <>
          {settings && !settings.shop_open && (
            <div className="st-banner info">
              The shop is switched off, so guardians can’t see it. Add your products, then turn the shop on in Store settings when you’re ready.
            </div>
          )}
          {actionError && <div className="st-banner err">{actionError}</div>}
          <div className="gfc-stat-row">
            <Stat color={T.indigo} label="Shown in the shop" value={stats.shown} />
            <Stat color={T.amber} label="Low stock (1-2 left)" value={stats.low} />
            <Stat color={T.danger} label="Sold out (product or size)" value={stats.soldOut} />
            <Stat color="#6b5cc4" label="Pre-orders open" value={stats.preordersOpen} />
          </div>
          <div className="gfc-panel">
            <div className="gfc-panel-head"><div className="gfc-panel-title">Products ({products.length})</div></div>
            {products.length === 0 ? (
              <div className="gfc-empty">
                <div className="gfc-empty-title gfc-display">No products yet</div>
                Add your first product: kit, supporters’ gear or anything else the club sells.
              </div>
            ) : (
              <div className="st-scroll">
                <table className="gfc-table">
                  <thead>
                    <tr><th style={{ width: 40 }}>Order</th><th>Product</th><th>Price</th><th>Availability</th><th>Stock</th><th>Shown</th></tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr
                        key={p.id}
                        className="st-row"
                        tabIndex={0}
                        onClick={() => setEditing(p)}
                        onKeyDown={(e) => { if (e.key === "Enter") setEditing(p); }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <span className="st-arrows">
                            <button className="st-arrow" aria-label={`Move ${p.name} up`} disabled={i === 0 || !!busyId} onClick={() => move(p, -1)}>▲</button>
                            <button className="st-arrow" aria-label={`Move ${p.name} down`} disabled={i === products.length - 1 || !!busyId} onClick={() => move(p, 1)}>▼</button>
                          </span>
                        </td>
                        <td><div className="st-prod"><Thumb src={photoUrl(p.photoPath)} />{p.name}</div></td>
                        <td className="st-money">{fmtMoney(p.price)}</td>
                        <td><AvailabilityBadge product={p} today={today} /></td>
                        <td style={{ maxWidth: 300 }}><StockCell product={p} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <label className="st-switch">
                            <input type="checkbox" checked={p.visible} disabled={busyId === p.id} onChange={() => toggleVisible(p)} aria-label={`Show ${p.name} in the shop`} />
                            <span />
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="st-hint" style={{ marginTop: 10 }}>Products appear in the shop in this order. Use the arrows to move them.</div>
        </>
      ) : tab === "orders" ? (
        <OrdersPanel products={products} onStockChanged={refresh} showToast={showToast} />
      ) : (
        <SettingsPanel settings={settings} onSaved={(row) => { setSettings(row); showToast("Store settings saved"); }} />
      )}

      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); await refresh(); showToast(msg); }}
          onDeleted={async (msg) => { setEditing(null); await refresh(); showToast(msg); }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

/* ============================== Product form ============================== */

function toForm(product) {
  if (!product) return { ...blankProduct(), sizes: [] };
  return {
    ...product,
    price: product.price ? product.price.toFixed(2) : "",
    stock: product.stock === null || product.stock === undefined ? "0" : String(product.stock),
    sizes: product.sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock === null ? "0" : String(s.stock) })),
  };
}

function ProductModal({ product, onClose, onSaved, onDeleted }) {
  const initial = useMemo(() => toForm(product), [product]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(null); // { blob, previewUrl } for a newly chosen photo
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || !!photo || photoRemoved;

  // Which error message each field's edits should clear.
  const ERROR_FOR = { name: "name", price: "price", stock: "stock", description: "description",
    preorderClosesOn: "closes", preorderExpected: "expected", hasSizes: "sizes", saleMode: "sizes" };
  function clearError(key) {
    if (!key) return;
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    setSaveError("");
  }
  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    clearError(ERROR_FOR[field]);
  }
  function updateSize(i, field, value) {
    setForm((f) => ({ ...f, sizes: f.sizes.map((s, j) => (j === i ? { ...s, [field]: value } : s)) }));
    clearError("sizes");
  }
  function setSizes(sizes) {
    setForm((f) => ({ ...f, sizes }));
    clearError("sizes");
  }
  function applyPreset(labels) {
    // Keep ids and stock of sizes that already exist with the same label.
    const byLabel = new Map(form.sizes.map((s) => [s.label.trim().toLowerCase(), s]));
    setSizes(labels.map((label) => byLabel.get(label.toLowerCase()) || { id: "", label, stock: "0" }));
  }

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm("Discard your changes to this product?")) return;
    onClose();
  }

  async function choosePhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) { setSaveError("Choose a photo (JPG, PNG or WebP)."); return; }
    if (file.size > PHOTO_MAX_INPUT_BYTES) { setSaveError("That photo is over 15 MB. Choose a smaller one."); return; }
    setPhotoBusy(true);
    setSaveError("");
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPhotoRemoved(false);
    } catch (err) {
      setSaveError(err.message || "That photo couldn’t be used.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSave() {
    const result = validateProduct(form);
    setErrors(result.errors);
    if (!result.ok) { setSaveError("Check the highlighted fields."); return; }
    setBusy(true);
    setSaveError("");
    const isNew = !product;
    const id = product ? product.id : crypto.randomUUID();
    const oldPath = product?.photoPath || "";
    let uploadedPath = "";
    try {
      if (photo) uploadedPath = await uploadPhoto(id, photo.blob);
      const finalPath = uploadedPath || (photoRemoved ? "" : oldPath);
      const payload = {
        ...result.product,
        id,
        is_new: isNew,
        photo_path: finalPath,
        // Lets the database refuse this save if the product changed
        // (e.g. a sale reduced stock) after this form was opened.
        ...(isNew ? {} : { expected_updated_at: product.updatedAt }),
      };
      await saveProduct(payload, result.sizes);
      if (oldPath && oldPath !== finalPath) await removePhoto(oldPath);
      onSaved(isNew ? `${result.product.name} added` : "Product saved");
    } catch (err) {
      if (uploadedPath) await removePhoto(uploadedPath);
      setSaveError(friendlyStoreError(err));
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${product.name}? This can’t be undone. To take it out of the shop for now, hide it instead.`)) return;
    setBusy(true);
    setSaveError("");
    try {
      await deleteProduct(product);
      onDeleted(`${product.name} deleted`);
    } catch (err) {
      setSaveError(friendlyStoreError(err));
      setBusy(false);
    }
  }

  const currentPhoto = photo ? photo.previewUrl : photoRemoved ? "" : photoUrl(form.photoPath);
  const isPre = form.saleMode === "preorder";

  return (
    <div className="gfc-modal-backdrop" onClick={requestClose}>
      <div className="gfc-modal st-wide" role="dialog" aria-modal="true" aria-label={product ? "Edit product" : "Add product"} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{product ? "Edit product" : "Add product"}</div>
          <button className="gfc-modal-close" onClick={requestClose} aria-label="Close">×</button>
        </div>

        <div className="st-photo">
          <Thumb src={currentPhoto} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Product photo</div>
            <div className="st-hint" style={{ margin: "2px 0 8px" }}>One photo. Square photos look best. Large photos are shrunk automatically.</div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} hidden />
            <button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={photoBusy || busy}>
              {photoBusy ? "Preparing…" : currentPhoto ? "Replace photo" : "Upload photo"}
            </button>
            {currentPhoto && (
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" style={{ marginLeft: 6 }} disabled={busy}
                onClick={() => { setPhoto(null); setPhotoRemoved(true); }}>
                Remove photo
              </button>
            )}
          </div>
        </div>

        <div className="gfc-row2">
          <div className="gfc-field">
            <label className="gfc-label" htmlFor="sp-name">Name</label>
            <input className="gfc-input" id="sp-name" value={form.name} maxLength={120} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Home jersey 2026" />
            {errors.name && <div className="st-err">{errors.name}</div>}
          </div>
          <div className="gfc-field">
            <label className="gfc-label" htmlFor="sp-price">Price (R)</label>
            <input className="gfc-input" id="sp-price" inputMode="decimal" value={form.price} onChange={(e) => update("price", e.target.value)} placeholder="450.00" />
            {errors.price && <div className="st-err">{errors.price}</div>}
          </div>
        </div>
        <div className="gfc-field">
          <label className="gfc-label" htmlFor="sp-desc">Description</label>
          <textarea className="gfc-textarea" id="sp-desc" rows={2} maxLength={2000} value={form.description} onChange={(e) => update("description", e.target.value)} />
          {errors.description && <div className="st-err">{errors.description}</div>}
        </div>

        <div className="gfc-label" style={{ marginBottom: 6 }}>How it’s sold</div>
        <div className="st-radio-row" role="radiogroup">
          <label className={`st-radio ${!isPre ? "on" : ""}`}>
            <input type="radio" name="sp-mode" checked={!isPre} onChange={() => update("saleMode", "stock")} />
            <span><b>In stock</b><small>Limited to the quantity you have. Shows “Sold out” at zero.</small></span>
          </label>
          <label className={`st-radio ${isPre ? "on" : ""}`}>
            <input type="radio" name="sp-mode" checked={isPre} onChange={() => update("saleMode", "preorder")} />
            <span><b>Pre-order</b><small>No stock limit. Guardians pay now; you order from the supplier later.</small></span>
          </label>
        </div>

        {isPre && (
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="sp-closes">Pre-orders close</label>
              <input className="gfc-input" type="date" id="sp-closes" value={form.preorderClosesOn} onChange={(e) => update("preorderClosesOn", e.target.value)} />
              {errors.closes ? <div className="st-err">{errors.closes}</div> : <div className="st-hint">Optional. The product leaves the shop after this date.</div>}
            </div>
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="sp-exp">Expected arrival (shown to guardians)</label>
              <input className="gfc-input" id="sp-exp" maxLength={120} value={form.preorderExpected} onChange={(e) => update("preorderExpected", e.target.value)} placeholder="e.g. Expected mid-November" />
              {errors.expected && <div className="st-err">{errors.expected}</div>}
            </div>
          </div>
        )}

        <label className="st-check">
          <input type="checkbox" checked={form.hasSizes} onChange={(e) => {
            const on = e.target.checked;
            setForm((f) => ({ ...f, hasSizes: on, sizes: on && f.sizes.length === 0 ? [{ id: "", label: "", stock: "0" }] : f.sizes }));
            clearError("sizes");
            clearError("stock");
          }} />
          <span><b>Sold in sizes</b> <span className="st-muted">{isPre ? "(guardians choose a size)" : "(each size has its own stock)"}</span></span>
        </label>

        {form.hasSizes ? (
          <>
            <table className="st-sizes">
              <thead><tr><th>Size</th>{!isPre && <th style={{ width: 120 }}>In stock</th>}<th style={{ width: 30 }} /></tr></thead>
              <tbody>
                {form.sizes.map((s, i) => (
                  <tr key={s.id || `new-${i}`}>
                    <td><input className="gfc-input" value={s.label} maxLength={20} placeholder="e.g. M" aria-label={`Size ${i + 1} name`} onChange={(e) => updateSize(i, "label", e.target.value)} /></td>
                    {!isPre && (
                      <td><input className="gfc-input" type="number" min="0" step="1" value={s.stock} aria-label={`Stock for size ${s.label || i + 1}`} onChange={(e) => updateSize(i, "stock", e.target.value)} /></td>
                    )}
                    <td><button type="button" className="st-x" aria-label={`Remove size ${s.label || i + 1}`} onClick={() => setSizes(form.sizes.filter((_, j) => j !== i))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {errors.sizes && <div className="st-err" style={{ marginBottom: 8 }}>{errors.sizes}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => setSizes([...form.sizes, { id: "", label: "", stock: "0" }])}>+ Add size</button>
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => applyPreset(SIZE_PRESETS.kidsAdult)}>Use kids + adult sizes</button>
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => applyPreset(SIZE_PRESETS.juniorSenior)}>Use Junior / Senior</button>
            </div>
          </>
        ) : !isPre ? (
          <div className="gfc-field" style={{ maxWidth: 200 }}>
            <label className="gfc-label" htmlFor="sp-stock">In stock</label>
            <input className="gfc-input" id="sp-stock" type="number" min="0" step="1" value={form.stock} onChange={(e) => update("stock", e.target.value)} />
            {errors.stock && <div className="st-err">{errors.stock}</div>}
          </div>
        ) : null}

        <label className="st-check">
          <span className="st-switch">
            <input type="checkbox" checked={form.visible} onChange={(e) => update("visible", e.target.checked)} />
            <span />
          </span>
          <b>Show in the Player Portal shop</b>
        </label>

        {saveError && <div className="st-banner err" style={{ marginBottom: 0 }}>{saveError}</div>}

        <div className="gfc-modal-actions">
          {product && (
            <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={handleDelete} disabled={busy}>Delete</button>
          )}
          <button type="button" className="gfc-btn gfc-btn-ghost" onClick={requestClose} disabled={busy}>Cancel</button>
          <button type="button" className="gfc-btn gfc-btn-primary" onClick={handleSave} disabled={busy || photoBusy}>
            {busy ? "Saving…" : product ? "Save changes" : "Add product"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================== Store settings ============================== */

function settingsToForm(s) {
  return {
    shopOpen: !!s?.shop_open,
    adminFeePercent: s ? String(Number(s.admin_fee_percent)) : "3.5",
    contactEmail: s?.contact_email || "",
    contactPhone: s?.contact_phone || "",
    policyText: s?.policy_text || "",
  };
}

function SettingsPanel({ settings, onSaved }) {
  const [form, setForm] = useState(() => settingsToForm(settings));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(settingsToForm(settings)); }, [settings]);

  if (!settings) {
    return <div className="st-banner err">Store settings are missing. Run the store migration in Supabase, then reload this page.</div>;
  }

  const SETTINGS_ERROR_FOR = { adminFeePercent: "fee", contactEmail: "email", contactPhone: "phone", policyText: "policy" };
  const update = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    const key = SETTINGS_ERROR_FOR[field];
    if (key) setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    setSaveError("");
  };
  const feeCheck = validateSettings(form);
  const feePct = feeCheck.errors.fee ? null : Number(String(form.adminFeePercent).replace(",", ".").replace("%", ""));
  const sections = policySections(form.policyText);

  async function handleSave() {
    const result = validateSettings(form);
    setErrors(result.errors);
    if (!result.ok) { setSaveError("Check the highlighted fields."); return; }
    if (result.settings.shop_open && !settings.shop_open &&
        !window.confirm("Turn the shop on? Guardians will be able to see and buy visible products once the Player Portal shop is installed.")) return;
    setBusy(true);
    setSaveError("");
    try {
      const row = await saveSettings(result.settings);
      onSaved(row);
    } catch (e) {
      setSaveError(friendlyStoreError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-policy-grid">
      <div>
        <div className="gfc-panel" style={{ padding: 18, marginBottom: 18 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Shop</div>
          <label className="st-check" style={{ margin: "0 0 4px" }}>
            <span className="st-switch">
              <input type="checkbox" checked={form.shopOpen} onChange={(e) => update("shopOpen", e.target.checked)} />
              <span />
            </span>
            <b>Shop is open to guardians</b>
          </label>
          <div className="st-hint" style={{ marginBottom: 16 }}>
            When off, guardians can’t see the shop at all. The Player Portal shop arrives in the next update, so this has no visible effect yet.
          </div>

          <div className="gfc-field" style={{ maxWidth: 220, marginBottom: 0 }}>
            <label className="gfc-label" htmlFor="ss-fee">Admin fee (% of each order)</label>
            <input className="gfc-input" id="ss-fee" inputMode="decimal" value={form.adminFeePercent} onChange={(e) => update("adminFeePercent", e.target.value)} />
            {errors.fee && <div className="st-err">{errors.fee}</div>}
          </div>
          <div className="st-fee-example">
            {feePct === null ? (
              "Enter a percentage to see an example."
            ) : feePct === 0 ? (
              "No admin fee: guardians pay the product prices only."
            ) : (
              <>
                On a {fmtMoney(450)} order, guardians pay {fmtMoney(450)} + {fmtMoney(adminFee(450, feePct))} admin fee = <b>{fmtMoney(450 + adminFee(450, feePct))}</b>.<br />
                <span className="st-muted">Shown as its own line in the cart and at checkout. Changing it only affects new orders.</span>
              </>
            )}
          </div>
        </div>

        <div className="gfc-panel" style={{ padding: 18 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 4 }}>Store policy</div>
          <div className="st-hint" style={{ marginBottom: 14 }}>
            Guardians see this in the shop and confirm they’ve read it at checkout.
            {settings.updated_at && ` Last saved ${fmtDate(settings.updated_at)}${settings.updated_by_email ? ` by ${settings.updated_by_email}` : ""}.`}
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="ss-email">Store contact email</label>
              <input className="gfc-input" id="ss-email" type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} placeholder="shop@garlandalefc.co.za" />
              {errors.email && <div className="st-err">{errors.email}</div>}
            </div>
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="ss-phone">Store contact number</label>
              <input className="gfc-input" id="ss-phone" value={form.contactPhone} maxLength={40} onChange={(e) => update("contactPhone", e.target.value)} placeholder="021 000 0000" />
              {errors.phone && <div className="st-err">{errors.phone}</div>}
            </div>
          </div>
          <div className="gfc-field">
            <label className="gfc-label" htmlFor="ss-policy">Policy text</label>
            <textarea className="gfc-textarea" id="ss-policy" rows={18} value={form.policyText} onChange={(e) => update("policyText", e.target.value)} style={{ lineHeight: 1.5 }} />
            {errors.policy ? <div className="st-err">{errors.policy}</div> : (
              <div className="st-hint">Leave a blank line between sections. The first line of a section becomes its heading. The admin fee and contact details are added automatically.</div>
            )}
          </div>
          {saveError && <div className="st-banner err">{saveError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="gfc-btn gfc-btn-primary" onClick={handleSave} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          </div>
        </div>
      </div>

      <div className="st-preview" aria-label="Policy preview">
        <div className="st-preview-label">How guardians will see it</div>
        <div className="st-preview-title">Store policy</div>
        {sections.map((s, i) => (
          <div key={i}>
            {s.heading && <h4>{s.heading}</h4>}
            <p style={s.heading ? undefined : { marginTop: 10 }}>{s.body}</p>
          </div>
        ))}
        {feePct !== null && feePct > 0 && (
          <div>
            <h4>Admin fee</h4>
            <p>An admin fee of {feePct}% of the order value is added at checkout to cover card processing costs. It’s shown in your cart before you pay.</p>
          </div>
        )}
        {(form.contactEmail.trim() || form.contactPhone.trim()) && (
          <div>
            <h4>Contact</h4>
            <p>{[form.contactEmail.trim(), form.contactPhone.trim()].filter(Boolean).join(" · ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================= Orders ================================= */

const ORDER_BADGE = {
  paid: ["gfc-badge gfc-badge-amber", "Paid · to prepare"],
  prepaid: ["gfc-badge gfc-badge-neutral", "Paid · pre-order", { background: "#ecebf8", color: "#3b2f86" }],
  supplier: ["gfc-badge gfc-badge-neutral", "Ordered from supplier"],
  ready: ["gfc-badge gfc-badge-green", "Ready for collection"],
  collected: ["gfc-badge gfc-badge-neutral", "Collected"],
  refunded: ["gfc-badge gfc-badge-red", "Refunded"],
};
function OrderBadge({ status }) {
  const b = ORDER_BADGE[status];
  if (!b) return null;
  return <span className={b[0]} style={b[2]}>{b[1]}</span>;
}
const fmtStamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
};
const lineLabel = (l) => `${l.quantity} × ${l.name}${l.size ? ` (${l.size})` : ""}`;

function OrdersPanel({ products, onStockChanged, showToast }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({ q: "", status: "open", period: "all" });
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState("");

  const reload = useCallback(async () => {
    try {
      setOrders(await loadOrders());
      setError("");
    } catch (e) {
      setError(friendlyStoreError(e));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const today = todayISO();
  const list = useMemo(() => (orders ? filterOrders(orders, filter, today) : []), [orders, filter, today]);
  const stats = useMemo(() => orderStats(orders || [], today.slice(0, 7)), [orders, today]);
  const supplier = useMemo(() => supplierSummary(orders || []), [orders]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  if (error && !orders) {
    return (
      <div className="st-banner err">
        Couldn’t load orders: {error}{" "}
        <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={reload}>Try again</button>
      </div>
    );
  }
  if (!orders) return <div className="gfc-empty">Loading orders…</div>;

  async function orderSupplier(productId, name) {
    if (!window.confirm(`Mark all paid ${name} pre-orders as ordered from the supplier? Guardians will see “Ordered from supplier”.`)) return;
    setBusy(productId);
    try {
      const n = await markSupplierOrdered(productId);
      await reload();
      showToast(`${n} order${n === 1 ? "" : "s"} marked as ordered from supplier`);
    } catch (e) {
      setError(friendlyStoreError(e));
    } finally {
      setBusy("");
    }
  }

  function downloadCsv() {
    const blob = new Blob(["\ufeff" + ordersToCsv(list)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `store-orders-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const open = openId ? orders.find((o) => o.id === openId) : null;

  return (
    <>
      {error && <div className="st-banner err">{error}</div>}
      <div className="gfc-stat-row">
        <Stat color={T.amber} label="Orders to prepare" value={stats.toPrepare} />
        <Stat color={T.green} label="Waiting for collection" value={stats.waiting} />
        <Stat color="#6b5cc4" label="Pre-order items to order" value={stats.preorderItems} />
        <Stat color={T.indigo} label="Sales this month" value={<span style={{ fontSize: 21 }}>{fmtMoney(stats.sales)}</span>} />
      </div>

      {stats.attention > 0 && (
        <div className="st-attention">
          <b>{stats.attention} order{stats.attention === 1 ? " needs" : "s need"} attention</b>, for example an item that sold out as it was paid for, or a payment that doesn’t match.{" "}
          <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => setFilter((f) => ({ ...f, status: "attention" }))}>Show them</button>
        </div>
      )}

      {supplier.map((s) => {
        const p = productById.get(s.productId);
        return (
          <div className="st-supplier" key={s.productId}>
            <div className="st-supplier-head">
              <div>
                <b>{s.name}</b>{" "}
                <span className="st-muted">
                  · {p && p.preorderClosesOn ? `pre-orders close ${fmtDate(p.preorderClosesOn)} · ` : ""}{s.total} to order from the supplier
                </span>
              </div>
              <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={busy === s.productId} onClick={() => orderSupplier(s.productId, s.name)}>
                {busy === s.productId ? "Updating…" : "Mark all as ordered from supplier"}
              </button>
            </div>
            <div className="st-pills">{s.sizes.map((z) => <span key={z.size}>{z.size}<b>× {z.quantity}</b></span>)}</div>
          </div>
        );
      })}

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Orders ({list.length})</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={reload}>Refresh</button>
            <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={downloadCsv} disabled={list.length === 0}>Download CSV</button>
          </div>
        </div>
        <div className="st-filters">
          <input className="gfc-input" style={{ minWidth: 260 }} placeholder="Search order number, name, email or phone" aria-label="Search orders"
            value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
          <select className="gfc-select" aria-label="Status" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
            <option value="open">Open orders</option>
            <option value="all">All orders</option>
            <option value="attention">Needs attention</option>
            <option value="paid">Paid · to prepare</option>
            <option value="prepaid">Paid · pre-order</option>
            <option value="supplier">Ordered from supplier</option>
            <option value="ready">Ready for collection</option>
            <option value="collected">Collected</option>
            <option value="refunded">Refunded</option>
          </select>
          <select className="gfc-select" aria-label="Period" value={filter.period} onChange={(e) => setFilter((f) => ({ ...f, period: e.target.value }))}>
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="3m">Last 3 months</option>
          </select>
        </div>
        {list.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">{orders.length === 0 ? "No orders yet" : "No orders match"}</div>
            {orders.length === 0 ? "Paid orders from the Player Portal shop appear here." : "Try a different search, status or period."}
          </div>
        ) : (
          <div className="st-scroll" style={{ marginTop: 14 }}>
            <table className="gfc-table">
              <thead><tr><th>Order</th><th>Paid</th><th>Guardian</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className="st-row" tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={(e) => { if (e.key === "Enter") setOpenId(o.id); }}>
                    <td className="gfc-mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{o.number}{o.needsAttention && <span className="st-flag">Check</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(o.paidAt)}</td>
                    <td>{o.guardianName}<div className="st-muted">{o.guardianPhone}</div></td>
                    <td style={{ fontSize: 12.5 }}>{o.lines.map((l) => <div key={l.id}>{lineLabel(l)}</div>)}</td>
                    <td className="st-money">{fmtMoney(o.total)}</td>
                    <td><OrderBadge status={orderStatus(o)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <OrderModal
          order={open}
          onClose={() => setOpenId(null)}
          onChanged={async (msg, stockChanged) => {
            await reload();
            if (stockChanged) await onStockChanged();
            if (msg) showToast(msg);
          }}
        />
      )}
    </>
  );
}

function OrderModal({ order, onClose, onChanged }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const remaining = Math.round((order.total - order.refundedTotal) * 100) / 100;
  const [refund, setRefund] = useState({ amount: remaining.toFixed(2), reason: "", done: false });
  const [resolveNote, setResolveNote] = useState("");

  const groups = [
    ["In-stock items", order.lines.filter((l) => !l.isPreorder), false],
    ["Pre-order items", order.lines.filter((l) => l.isPreorder), true],
  ].filter((g) => g[1].length);
  const refundable = order.lines.some((l) => l.status !== "refunded");

  async function run(key, fn, msg, stockChanged = false) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await onChanged(msg, stockChanged);
      return true;
    } catch (e) {
      setError(friendlyStoreError(e));
      return false;
    } finally {
      setBusy("");
    }
  }

  function submitRefund() {
    const amount = parsePrice(refund.amount);
    if (amount === null || amount <= 0) { setError("Enter the amount you refunded, e.g. 465.75."); return; }
    if (amount > remaining) { setError(`That’s more than was paid. At most ${fmtMoney(remaining)} can be refunded.`); return; }
    if (refund.reason.trim().length < 3) { setError("Enter a reason for the refund."); return; }
    if (!refund.done) { setError("Refund the payment in the Yoco Business Portal first, then tick the box."); return; }
    run("refund", () => recordRefund(order.id, amount, refund.reason.trim()), "Refund recorded", true)
      .then((ok) => { if (ok) setRefundOpen(false); });
  }

  return (
    <div className="gfc-modal-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <div className="gfc-modal st-wide" role="dialog" aria-modal="true" aria-label={`Order ${order.number}`} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">Order {order.number}</div>
          <button className="gfc-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {order.needsAttention && (
          <div className="st-attention">
            <b>Needs attention.</b> {order.attentionNote}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input className="gfc-input" style={{ flex: 1, minWidth: 200 }} placeholder="What you did, e.g. Called guardian, refunded the bottle" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
              <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={!!busy} onClick={() => run("resolve", () => resolveAttention(order.id, resolveNote), "Marked as resolved")}>Mark as resolved</button>
            </div>
          </div>
        )}

        <div className="st-order-grid">
          <div className="st-box"><h4>Guardian</h4>{order.guardianName}<br />{order.guardianPhone}<br />{order.guardianEmail}</div>
          <div className="st-box">
            <h4>Payment</h4>
            Items {fmtMoney(order.subtotal)}{order.adminFee > 0 && <> + admin fee {fmtMoney(order.adminFee)}</>}<br />
            <b>{fmtMoney(order.total)}</b> paid {fmtDate(order.paidAt)} via Yoco<br />
            {order.refundedTotal > 0 && <><span style={{ color: T.danger, fontWeight: 700 }}>{fmtMoney(order.refundedTotal)} refunded</span><br /></>}
            <span className="st-muted">Yoco reference </span><span className="gfc-mono" style={{ fontSize: 11.5 }}>{order.yocoPaymentId}</span>
          </div>
        </div>

        {groups.map(([title, lines, pre]) => {
          const step = nextStep(lines);
          return (
            <div className="st-group" key={title}>
              <div className="st-group-head"><b style={{ fontSize: 13 }}>{groups.length > 1 ? title : "Items"}</b><OrderBadge status={groupStatus(lines)} /></div>
              {lines.map((l) => (
                <div className="st-line" key={l.id}>
                  <span>{lineLabel(l)}{l.stockShort && <span className="st-short">Sold out when paid</span>}</span>
                  <span className="st-money">{fmtMoney(l.quantity * l.unitPrice)}</span>
                </div>
              ))}
              {step && (
                <div style={{ marginTop: 10 }}>
                  <button className="gfc-btn gfc-btn-primary gfc-btn-sm" disabled={!!busy}
                    onClick={() => run(`adv-${pre}`, () => advanceItems(order.id, pre, step.to), step.label.replace("Mark as ", "Marked as "))}>
                    {busy === `adv-${pre}` ? "Updating…" : step.label}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div className="st-sub-head">History</div>
        <ul className="st-history">
          {order.events.map((e, i) => (
            <li key={i}><time>{fmtStamp(e.at)}</time><span>{e.message}{e.by && <span className="st-muted"> · {e.by}</span>}</span></li>
          ))}
        </ul>

        {refundOpen && (
          <div className="st-refund">
            <p><b>Record a refund.</b> First refund the guardian in the Yoco Business Portal, then record it here. Items that weren’t collected go back into stock.</p>
            <div className="gfc-row2">
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="rf-amount">Amount refunded (R)</label>
                <input className="gfc-input" id="rf-amount" inputMode="decimal" value={refund.amount} onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} />
                <div className="st-hint">Full order: {fmtMoney(remaining)}{order.adminFee > 0 && `, or ${fmtMoney(Math.max(0, remaining - order.adminFee))} without the admin fee`}.</div>
              </div>
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="rf-reason">Reason</label>
                <input className="gfc-input" id="rf-reason" placeholder="e.g. Wrong size, cancelled within 7 days" value={refund.reason} onChange={(e) => setRefund((r) => ({ ...r, reason: e.target.value }))} />
              </div>
            </div>
            <label className="st-check"><input type="checkbox" checked={refund.done} onChange={(e) => setRefund((r) => ({ ...r, done: e.target.checked }))} />I’ve refunded this in the Yoco Business Portal</label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => { setRefundOpen(false); setError(""); }} disabled={!!busy}>Cancel</button>
              <button className="gfc-btn gfc-btn-danger gfc-btn-sm" onClick={submitRefund} disabled={!!busy}>{busy === "refund" ? "Recording…" : "Record refund"}</button>
            </div>
          </div>
        )}

        {error && <div className="st-banner err" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}

        <div className="gfc-modal-actions">
          {refundable && !refundOpen && (
            <button className="gfc-btn gfc-btn-ghost" style={{ marginRight: "auto", color: T.danger }} onClick={() => setRefundOpen(true)}>Record a refund…</button>
          )}
          <button className="gfc-btn gfc-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
