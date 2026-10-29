import React, { useState } from "react";
import { T } from "../theme.js";
import { fmtMoney } from "../lib/format.js";
import { diffFields } from "../lib/auditLog.js";
import { usePagination, Pagination } from "./shared.jsx";

const TABLE_LABELS = {
  payments: "Payment",
  finance_entries: "Finance entry",
  tiers: "Subscription tier",
  club_assets: "Club asset",
};

const ACTION_LABELS = { INSERT: "Created", UPDATE: "Edited", DELETE: "Deleted" };
const ACTION_BADGE = { INSERT: "gfc-badge-green", UPDATE: "gfc-badge-amber", DELETE: "gfc-badge-red" };
const MONEY_FIELDS = new Set(["amount", "monthly_fee", "unit_value"]);

function formatDiffValue(value, key) {
  if (value === null) return "—";
  if (MONEY_FIELDS.has(key)) return fmtMoney(Number(value));
  return String(value);
}

function describeAuditEntry(entry, players) {
  // For payments specifically, resolve player_id to a name for context -
  // "R350 payment" means a lot more as "R350 payment - Thabo Nkosi".
  const data = entry.newData || entry.oldData || {};
  if (entry.tableName === "payments" && data.player_id) {
    const player = (players || []).find((p) => p.id === data.player_id);
    if (player) return player.name;
  }
  return null;
}

export function BackupsView({ backups, onRefresh, onBackupNow, onRestore, onDownload, onRestoreFromFile, busy, lastMessage, auditLog, players }) {
  const fileInputRef = React.useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const { page, setPage, totalPages, pageItems: auditPage } = usePagination(auditLog || [], { pageSize: 15 });

  function handleFileChosen(e) {
    const file = e.target.files?.[0];
    if (file) onRestoreFromFile(file);
    e.target.value = "";
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Backups</div>
          <div className="gfc-page-sub">Automatic nightly snapshot at 11pm · last 10 snapshots kept</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="gfc-btn gfc-btn-outline" onClick={onRefresh} disabled={busy}>Refresh list</button>
          <button className="gfc-btn gfc-btn-primary" onClick={onBackupNow} disabled={busy}>
            {busy ? "Working…" : "Back up now"}
          </button>
        </div>
      </div>

      {lastMessage && (
        <div style={{ background: T.amberSoft, border: `1px solid ${T.gold}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#7a5410", marginBottom: 16 }}>
          {lastMessage}
        </div>
      )}

      <div style={{ background: T.paperDim, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: T.inkSoft, marginBottom: 18 }}>
        Nightly snapshots protect against mistakes (accidental deletes, bad edits) — restoring rolls the whole club's data back to that point in time. For protection against losing the Supabase project itself, occasionally use <strong>Download</strong> below and save the file somewhere off-project (Google Drive, email to yourself, etc).
      </div>

      <div className="gfc-panel" style={{ marginBottom: 18 }}>
        <div className="gfc-panel-head"><div className="gfc-panel-title">Snapshots ({backups.length})</div></div>
        {backups.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No snapshots yet</div>
            Click "Back up now" to create your first one, or wait for tonight's automatic run.
          </div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead><tr><th>Date &amp; time</th><th>Type</th><th></th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{new Date(b.created_at).toLocaleString("en-ZA")}</td>
                  <td><span className={`gfc-badge ${b.kind === "manual" ? "gfc-badge-neutral" : "gfc-badge-green"}`}><span className="gfc-dot" />{b.kind === "manual" ? "Manual" : "Automatic"}</span></td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => onDownload(b.id)} disabled={busy}>Download</button>
                    <button className="gfc-btn gfc-btn-danger gfc-btn-sm" onClick={() => onRestore(b.id)} disabled={busy}>Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="gfc-panel" style={{ padding: 16, marginBottom: 18 }}>
        <div className="gfc-panel-title" style={{ marginBottom: 10 }}>Restore from a downloaded file</div>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 10 }}>
          Upload a previously downloaded backup file to restore the club's data from it.
        </div>
        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChosen} style={{ display: "none" }} />
        <button className="gfc-btn gfc-btn-outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          Choose backup file…
        </button>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Audit log — financial changes ({(auditLog || []).length})</div>
        </div>
        <div style={{ fontSize: 11.5, color: T.inkSoft, padding: "0 16px 12px" }}>
          Every change to payments, finance entries, subscription tiers, and club assets — captured automatically, however the change was made. Showing the most recent 200.
        </div>
        {(!auditLog || auditLog.length === 0) ? (
          <div className="gfc-empty">No changes recorded yet.</div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Table</th>
                <th>Action</th>
                <th>Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {auditPage.map((entry) => {
                const isExpanded = expandedId === entry.id;
                const changes = diffFields(entry.oldData, entry.newData);
                const context = describeAuditEntry(entry, players);
                return (
                  <React.Fragment key={entry.id}>
                    <tr className="clickable" onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                      <td>{new Date(entry.changedAt).toLocaleString("en-ZA")}</td>
                      <td>{entry.changedByEmail || "—"}</td>
                      <td>{TABLE_LABELS[entry.tableName] || entry.tableName}{context ? ` — ${context}` : ""}</td>
                      <td>
                        <span className={`gfc-badge ${ACTION_BADGE[entry.action] || "gfc-badge-neutral"}`}>
                          <span className="gfc-dot" />{ACTION_LABELS[entry.action] || entry.action}
                        </span>
                      </td>
                      <td style={{ fontSize: 11.5, color: T.inkSoft }}>
                        {changes.length} field{changes.length === 1 ? "" : "s"}
                      </td>
                      <td>
                        <button className="gfc-btn gfc-btn-outline gfc-btn-sm">{isExpanded ? "Hide" : "View"}</button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ background: T.paperDim, padding: "10px 16px" }}>
                          {changes.length === 0 ? (
                            <div style={{ fontSize: 12, color: T.inkSoft }}>No field-level changes recorded.</div>
                          ) : (
                            <table style={{ width: "100%", fontSize: 12 }}>
                              <thead>
                                <tr style={{ textAlign: "left", color: T.inkSoft }}>
                                  <th style={{ paddingRight: 16 }}>Field</th>
                                  <th style={{ paddingRight: 16 }}>Before</th>
                                  <th>After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((c, i) => (
                                  <tr key={i}>
                                    <td style={{ fontWeight: 600, paddingRight: 16 }}>{c.field}</td>
                                    <td style={{ paddingRight: 16, color: entry.action === "INSERT" ? T.inkSoft : T.danger }}>
                                      {formatDiffValue(c.oldValue, c.key)}
                                    </td>
                                    <td style={{ color: entry.action === "DELETE" ? T.inkSoft : T.green }}>
                                      {formatDiffValue(c.newValue, c.key)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={(auditLog || []).length} pageSize={15} />
      </div>
    </div>
  );
}
