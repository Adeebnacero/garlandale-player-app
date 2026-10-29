import React, { useState, useMemo } from "react";
import { T } from "../theme.js";
import { fmtMoney } from "../lib/format.js";

const CATEGORIES = ["Equipment", "Grounds", "Other"];

export function AssetsView({ assets, onAdd, onEdit }) {
  const [categoryFilter, setCategoryFilter] = useState("All");

  const filtered = useMemo(() => {
    return categoryFilter === "All" ? assets : assets.filter((a) => a.category === categoryFilter);
  }, [assets, categoryFilter]);

  const stats = useMemo(() => {
    const distinctItems = assets.length;
    const totalQuantity = assets.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const totalValue = assets.reduce((s, a) => s + (Number(a.quantity) || 0) * (Number(a.unitValue) || 0), 0);
    const lowStock = assets.filter((a) => a.lowStockThreshold > 0 && a.quantity <= a.lowStockThreshold).length;
    return { distinctItems, totalQuantity, totalValue, lowStock };
  }, [assets]);

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Club Assets</div>
          <div className="gfc-page-sub">Equipment, grounds gear, and other club-owned stock — not player kit</div>
        </div>
        <button className="gfc-btn gfc-btn-primary" onClick={onAdd}>+ Add asset</button>
      </div>

      <div className="gfc-stat-row">
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.indigo }} />
          <div className="gfc-stat-label">Distinct items</div>
          <div className="gfc-stat-value gfc-mono">{stats.distinctItems}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.green }} />
          <div className="gfc-stat-label">Total quantity</div>
          <div className="gfc-stat-value gfc-mono">{stats.totalQuantity}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.gold }} />
          <div className="gfc-stat-label">Total value</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.totalValue)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.danger }} />
          <div className="gfc-stat-label">Low stock</div>
          <div className="gfc-stat-value gfc-mono">{stats.lowStock}</div>
        </div>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">All club assets</div>
          <div className="gfc-filters">
            <select className="gfc-select" style={{ maxWidth: 160 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No assets yet</div>
            Add balls, bibs, poles, flags, or any other club-owned equipment to start tracking.
          </div>
        ) : (
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Quantity</th>
                <th>Unit value</th>
                <th>Total value</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isLow = a.lowStockThreshold > 0 && a.quantity <= a.lowStockThreshold;
                const totalValue = (Number(a.quantity) || 0) * (Number(a.unitValue) || 0);
                return (
                  <tr key={a.id} className="clickable" onClick={() => onEdit(a)}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td>{a.category || "—"}</td>
                    <td className="gfc-mono" style={{ color: isLow ? T.danger : T.ink, fontWeight: isLow ? 700 : 400 }}>{a.quantity}</td>
                    <td className="gfc-mono">{fmtMoney(a.unitValue)}</td>
                    <td className="gfc-mono" style={{ fontWeight: 700 }}>{fmtMoney(totalValue)}</td>
                    <td>
                      <span className={`gfc-badge ${isLow ? "gfc-badge-red" : "gfc-badge-green"}`}>
                        <span className="gfc-dot" />
                        {isLow ? "Low stock" : "OK"}
                      </span>
                    </td>
                    <td><button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(a); }}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function AssetModal({ asset, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: asset?.id || "",
    name: asset?.name || "",
    category: asset?.category || "Equipment",
    quantity: asset?.quantity ?? 0,
    unitValue: asset?.unitValue ?? 0,
    lowStockThreshold: asset?.lowStockThreshold ?? 0,
    notes: asset?.notes || "",
  }));

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave(form);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{asset ? "Edit asset" : "Add asset"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Item name</label>
            <input className="gfc-input" placeholder="Match balls, Corner flags, Lawnmower…" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Category</label>
            <select className="gfc-select" value={form.category} onChange={(e) => update("category", e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Quantity</label>
              <input type="number" min="0" className="gfc-input" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Unit value (R)</label>
              <input type="number" min="0" step="any" className="gfc-input" value={form.unitValue} onChange={(e) => update("unitValue", e.target.value)} />
            </div>
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Low stock threshold <span style={{ fontWeight: 400, textTransform: "none", color: T.inkSoft }}>(flag when quantity is at or below this — 0 to disable)</span></label>
            <input type="number" min="0" className="gfc-input" value={form.lowStockThreshold} onChange={(e) => update("lowStockThreshold", e.target.value)} />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Notes</label>
            <textarea className="gfc-textarea" rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </div>
          <div className="gfc-modal-actions">
            {asset && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(asset.id)}>
                Remove asset
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save asset</button>
          </div>
        </form>
      </div>
    </div>
  );
}
