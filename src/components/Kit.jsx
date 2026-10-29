import React, { useState } from "react";
import { T } from "../theme.js";
import { fmtDate, todayISO } from "../lib/format.js";

export function KitView({ inventory, issuedItems, enriched, onAddItem, onEditItem, onIssue, onReturn }) {
  const [issuePlayerId, setIssuePlayerId] = useState("");
  const [issueItemId, setIssueItemId] = useState("");
  const [issueSize, setIssueSize] = useState("");
  const [issueQty, setIssueQty] = useState(1);
  const [issueDate, setIssueDate] = useState(todayISO());

  const outstanding = issuedItems.filter((r) => !r.dateReturned);

  function handleIssue(e) {
    e.preventDefault();
    if (!issuePlayerId || !issueItemId) return;
    onIssue({ playerId: issuePlayerId, itemId: issueItemId, size: issueSize, quantity: Number(issueQty) || 1, dateIssued: issueDate, notes: "" });
    setIssuePlayerId("");
    setIssueItemId("");
    setIssueSize("");
    setIssueQty(1);
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Kit &amp; Stock</div>
          <div className="gfc-page-sub">Inventory levels and what's currently issued to players</div>
        </div>
        <button className="gfc-btn gfc-btn-primary" onClick={onAddItem}>+ Add stock item</button>
      </div>

      <div className="gfc-panel" style={{ marginBottom: 18 }}>
        <div className="gfc-panel-head"><div className="gfc-panel-title">Inventory</div></div>
        {inventory.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No stock items yet</div>
            Add jerseys, tracksuits, or other kit to start tracking.
          </div>
        ) : (
          <table className="gfc-table">
            <thead><tr><th>Item</th><th>Category</th><th>Size</th><th>In stock</th><th></th></tr></thead>
            <tbody>
              {inventory.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => onEditItem(i)}>
                  <td style={{ fontWeight: 600 }}>{i.name}</td>
                  <td>{i.category || "—"}</td>
                  <td>{i.size || "—"}</td>
                  <td className="gfc-mono" style={{ color: i.quantityOnHand <= 2 ? T.danger : T.ink, fontWeight: i.quantityOnHand <= 2 ? 700 : 400 }}>
                    {i.quantityOnHand}
                  </td>
                  <td><button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); onEditItem(i); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="gfc-panel" style={{ marginBottom: 18, padding: 16 }}>
        <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Issue kit to a player</div>
        <form onSubmit={handleIssue} className="gfc-row2" style={{ gridTemplateColumns: "1.4fr 1fr 0.7fr 0.6fr 1fr auto", alignItems: "end", gap: 8 }}>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Player</label>
            <select className="gfc-select" value={issuePlayerId} onChange={(e) => setIssuePlayerId(e.target.value)} required>
              <option value="">Select player</option>
              {enriched.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Item</label>
            <select className="gfc-select" value={issueItemId} onChange={(e) => setIssueItemId(e.target.value)} required>
              <option value="">Select item</option>
              {inventory.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantityOnHand} in stock)</option>)}
            </select>
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Size</label>
            <input className="gfc-input" value={issueSize} onChange={(e) => setIssueSize(e.target.value)} />
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Qty</label>
            <input type="number" min="1" className="gfc-input" value={issueQty} onChange={(e) => setIssueQty(e.target.value)} />
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Date</label>
            <input type="date" className="gfc-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <button type="submit" className="gfc-btn gfc-btn-primary">Issue</button>
        </form>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head"><div className="gfc-panel-title">Currently issued ({outstanding.length})</div></div>
        {outstanding.length === 0 ? (
          <div className="gfc-empty">Nothing currently out with players.</div>
        ) : (
          <table className="gfc-table">
            <thead><tr><th>Player</th><th>Item</th><th>Size</th><th>Qty</th><th>Issued</th><th></th></tr></thead>
            <tbody>
              {outstanding.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.playerName}</td>
                  <td>{r.itemName}</td>
                  <td>{r.size || "—"}</td>
                  <td className="gfc-mono">{r.quantity}</td>
                  <td>{fmtDate(r.dateIssued)}</td>
                  <td><button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => onReturn(r.id)}>Mark returned</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


export function ItemModal({ item, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: item?.id || "",
    name: item?.name || "",
    category: item?.category || "",
    size: item?.size || "",
    quantityOnHand: item?.quantityOnHand ?? 0,
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
          <div className="gfc-modal-title gfc-display">{item ? "Edit stock item" : "Add stock item"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Item name</label>
            <input className="gfc-input" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Category</label>
              <input className="gfc-input" placeholder="Jersey, Shorts, Tracksuit…" value={form.category} onChange={(e) => update("category", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Size</label>
              <input className="gfc-input" value={form.size} onChange={(e) => update("size", e.target.value)} />
            </div>
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Quantity on hand</label>
            <input type="number" min="0" className="gfc-input" value={form.quantityOnHand} onChange={(e) => update("quantityOnHand", e.target.value)} />
          </div>
          <div className="gfc-modal-actions">
            {item && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(item.id)}>
                Remove item
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save item</button>
          </div>
        </form>
      </div>
    </div>
  );
}
