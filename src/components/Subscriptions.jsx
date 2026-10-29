import React, { useState } from "react";
import { T } from "../theme.js";
import { fmtMoney, fmtDate, todayISO } from "../lib/format.js";
import { Badge, InactiveToggle, usePagination, Pagination } from "./shared.jsx";

export function SubscriptionsView({ enriched, tiers, includeInactive, setIncludeInactive, onOpenLedger, onManageTiers }) {
  const sorted = [...enriched].sort((a, b) => b.balance - a.balance);
  const totalDue = enriched.reduce((s, p) => s + p.due, 0);
  const totalPaid = enriched.reduce((s, p) => s + p.paid, 0);
  const totalOutstanding = enriched.reduce((s, p) => s + Math.max(0, p.balance), 0);

  const { page, setPage, totalPages, pageItems } = usePagination(sorted, { pageSize: 15, resetKey: includeInactive });

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Subscriptions</div>
          <div className="gfc-page-sub">Season runs January–October · fees, payments, and running balances</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <InactiveToggle includeInactive={includeInactive} setIncludeInactive={setIncludeInactive} />
          <button className="gfc-btn gfc-btn-outline" onClick={onManageTiers}>Manage tiers</button>
        </div>
      </div>

      <div className="gfc-stat-row">
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.indigo }} />
          <div className="gfc-stat-label">Total billed to date</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(totalDue)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.green }} />
          <div className="gfc-stat-label">Total collected</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(totalPaid)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.danger }} />
          <div className="gfc-stat-label">Outstanding</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(totalOutstanding)}</div>
        </div>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Player balances</div>
        </div>
        {sorted.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No players yet</div>
            Add players from the Squad tab to start tracking subscriptions.
          </div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age group</th>
                <th>Tier</th>
                <th>Billed to date</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => onOpenLedger(p)}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><span className="gfc-agepill">{p.ageGroup}</span></td>
                  <td>{p.tierName ? `${p.tierName} (${fmtMoney(p.fee)}/mo)` : <span style={{ color: T.amber, fontWeight: 700 }}>No tier set</span>}</td>
                  <td className="gfc-mono">{fmtMoney(p.due)}</td>
                  <td className="gfc-mono">{fmtMoney(p.paid)}</td>
                  <td className="gfc-mono" style={{ fontWeight: 700, color: p.balance > 0 ? T.danger : T.green }}>
                    {fmtMoney(p.balance)}
                  </td>
                  <td><Badge status={p.status} reason={p.reason} /></td>
                  <td><button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); onOpenLedger(p); }}>Ledger</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={sorted.length} pageSize={15} />
      </div>
    </div>
  );
}

export function LedgerModal({ player, onClose, onAddPayment, onRemovePayment, onEmailStatement, emailBusy, emailMessage }) {
  const [amount, setAmount] = useState(player.fee || "");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("EFT");

  function handleAdd(e) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    onAddPayment({ amount: amt, date, method });
    setAmount(player.fee || "");
  }

  const payments = [...(player.payments || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div>
            <div className="gfc-modal-title gfc-display">{player.name}</div>
            <div style={{ fontSize: 12, color: T.inkSoft }}>{player.ageGroup} · {player.tierName ? `${player.tierName} · ${fmtMoney(player.fee)}/month` : "No tier assigned"}</div>
          </div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
          <button
            className="gfc-btn gfc-btn-outline gfc-btn-sm"
            onClick={() => onEmailStatement(player)}
            disabled={emailBusy || !player.email}
            title={!player.email ? "No email address on file for this player" : "Email a PDF statement to this player"}
          >
            {emailBusy ? "Sending…" : "Email statement"}
          </button>
        </div>
        {emailMessage && (
          <div style={{ background: T.amberSoft, border: `1px solid ${T.gold}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#7a5410", marginBottom: 14 }}>
            {emailMessage}
          </div>
        )}

        <div className="gfc-stat-row" style={{ marginBottom: 18, gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="gfc-stat" style={{ padding: "12px 14px" }}>
            <div className="gfc-stat-label">Billed</div>
            <div className="gfc-stat-value gfc-mono" style={{ fontSize: 18 }}>{fmtMoney(player.due)}</div>
          </div>
          <div className="gfc-stat" style={{ padding: "12px 14px" }}>
            <div className="gfc-stat-label">Paid</div>
            <div className="gfc-stat-value gfc-mono" style={{ fontSize: 18 }}>{fmtMoney(player.paid)}</div>
          </div>
          <div className="gfc-stat" style={{ padding: "12px 14px" }}>
            <div className="gfc-stat-label">Balance</div>
            <div className="gfc-stat-value gfc-mono" style={{ fontSize: 18, color: player.balance > 0 ? T.danger : T.green }}>{fmtMoney(player.balance)}</div>
          </div>
        </div>

        <form onSubmit={handleAdd} className="gfc-row2" style={{ gridTemplateColumns: "1fr 1fr 1fr auto", alignItems: "end", gap: 8, marginBottom: 16 }}>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Amount (R)</label>
            <input type="number" min="0" step="any" className="gfc-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Date</label>
            <input type="date" className="gfc-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Method</label>
            <select className="gfc-select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>EFT</option>
              <option>Cash</option>
              <option>Card</option>
              <option>Other</option>
            </select>
          </div>
          <button type="submit" className="gfc-btn gfc-btn-primary">Log payment</button>
        </form>

        <div className="gfc-panel-title" style={{ marginBottom: 8 }}>Payment history</div>
        {payments.length === 0 ? (
          <div className="gfc-empty">No payments logged yet.</div>
        ) : (
          <table className="gfc-table">
            <thead>
              <tr><th>Date</th><th>Method</th><th>Amount</th><th></th></tr>
            </thead>
            <tbody>
              {payments.map((pm) => (
                <tr key={pm.id}>
                  <td>{fmtDate(pm.date)}</td>
                  <td>{pm.method}</td>
                  <td className="gfc-mono">{fmtMoney(pm.amount)}</td>
                  <td><button className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => onRemovePayment(pm.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="gfc-modal-actions">
          <button className="gfc-btn gfc-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function TierManagerModal({ tiers, onClose, onAdd, onEdit }) {
  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">Subscription tiers</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={onAdd}>+ Add tier</button>
        </div>

        {tiers.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No tiers yet</div>
            Add a tier (e.g. "Standard") to start assigning fees to players.
          </div>
        ) : (
          <div className="gfc-checklist" style={{ maxHeight: 320 }}>
            {tiers.map((t) => (
              <div key={t.id} className="gfc-checklist-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{t.name}</div>
                  {t.description && <div style={{ fontSize: 11.5, color: T.inkSoft }}>{t.description}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="gfc-mono" style={{ fontWeight: 700 }}>{fmtMoney(t.monthlyFee)}/mo</span>
                  <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => onEdit(t)}>Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="gfc-modal-actions">
          <button className="gfc-btn gfc-btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}


export function TierModal({ tier, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: tier?.id || "",
    name: tier?.name || "",
    monthlyFee: tier?.monthlyFee ?? 300,
    description: tier?.description || "",
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
          <div className="gfc-modal-title gfc-display">{tier ? "Edit tier" : "New tier"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Tier name</label>
            <input className="gfc-input" placeholder="e.g. Standard, Sibling discount" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Monthly fee (R)</label>
            <input type="number" min="0" step="any" className="gfc-input" value={form.monthlyFee} onChange={(e) => update("monthlyFee", e.target.value)} />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Description (optional)</label>
            <textarea className="gfc-textarea" rows={2} value={form.description} onChange={(e) => update("description", e.target.value)} />
          </div>
          <div className="gfc-modal-actions">
            {tier && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(tier.id)}>
                Delete tier
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save tier</button>
          </div>
        </form>
      </div>
    </div>
  );
}
