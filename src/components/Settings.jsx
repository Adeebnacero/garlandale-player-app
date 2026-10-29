import React, { useState, useEffect } from "react";
import { T } from "../theme.js";

export function SettingsView({ clubSettings, onSave, leagueSources, onAddLeagueSource, onEditLeagueSource }) {
  const [form, setForm] = useState(clubSettings);
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(clubSettings); }, [clubSettings]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const err = await onSave(form);
    setSaving(false);
    setSaved(err ? `Error: ${err}` : "Saved.");
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Settings</div>
          <div className="gfc-page-sub">Email sender details and invoice/statement defaults</div>
        </div>
      </div>

      <div style={{ background: T.amberSoft, border: `1px solid ${T.gold}`, borderRadius: 10, padding: "12px 16px", fontSize: 12.5, color: "#7a5410", marginBottom: 20 }}>
        <strong>About email sending:</strong> the Gmail address and app password used to actually send emails are configured separately as secure server-side secrets (via the Supabase CLI) — they never live in this database, since anyone with the app's URL and key can read what's stored here. This page only controls how outgoing emails are labelled and what they include. See the README's "Email statements" section for the one-time server setup steps.
      </div>

      <form onSubmit={handleSubmit}>
        <div className="gfc-panel" style={{ padding: 20, marginBottom: 18 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 14 }}>Sending identity</div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Sending Gmail address</label>
              <input className="gfc-input" placeholder="club@gmail.com" value={form.senderEmail} onChange={(e) => update("senderEmail", e.target.value)} />
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>For your reference only — must match the SMTP_USERNAME secret set on the server.</div>
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Display name on outgoing emails</label>
              <input className="gfc-input" value={form.senderDisplayName} onChange={(e) => update("senderDisplayName", e.target.value)} />
            </div>
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Reply-to address (optional)</label>
            <input className="gfc-input" placeholder="Leave blank to use the sending Gmail address" value={form.replyToEmail} onChange={(e) => update("replyToEmail", e.target.value)} />
          </div>
        </div>

        <div className="gfc-panel" style={{ padding: 20, marginBottom: 18 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 14 }}>Statement / invoice content</div>
          <div className="gfc-field">
            <label className="gfc-label">Banking details (shown on statements, for EFT payments)</label>
            <textarea className="gfc-textarea" rows={3} placeholder="Bank: ...&#10;Account name: ...&#10;Account no: ...&#10;Branch code: ..." value={form.bankDetails} onChange={(e) => update("bankDetails", e.target.value)} />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Footer note (optional, shown at the bottom of every statement)</label>
            <textarea className="gfc-textarea" rows={2} placeholder="e.g. Thank you for your support this season!" value={form.invoiceFooterNote} onChange={(e) => update("invoiceFooterNote", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="submit" className="gfc-btn gfc-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
          {saved && <span style={{ fontSize: 12.5, color: saved.startsWith("Error") ? T.danger : T.green, fontWeight: 600 }}>{saved}</span>}
        </div>
      </form>

      <div className="gfc-panel" style={{ padding: 20, marginTop: 18 }}>
        <div className="gfc-panel-title" style={{ marginBottom: 4 }}>Referees</div>
        <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 14 }}>
          The default match fee used when a referee is first assigned to a fixture. It's editable per appointment afterwards on the Referee Pay tab, so this is just the starting point. Saved together with "Save settings" above.
        </div>
        <div className="gfc-field" style={{ maxWidth: 220, marginBottom: 0 }}>
          <label className="gfc-label">Default referee fee (R)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="gfc-input"
            value={form.defaultRefereeFee}
            onChange={(e) => update("defaultRefereeFee", e.target.value)}
          />
        </div>
      </div>

      <div className="gfc-panel" style={{ padding: 20, marginTop: 18 }}>
        <div className="gfc-panel-head" style={{ marginBottom: 4 }}>
          <div className="gfc-panel-title">League table sources</div>
          <button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={onAddLeagueSource}>+ Add division</button>
        </div>
        <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 14 }}>
          Public standings URLs from the federation's own site (LeagueRepublic), one per division Garlandale plays in. Fetched and refreshed automatically every Monday morning — shown on the Squad tab's League Table view.
        </div>
        {(!leagueSources || leagueSources.length === 0) ? (
          <div className="gfc-empty">No divisions added yet.</div>
        ) : (
          <table className="gfc-table">
            <thead><tr><th>Division</th><th>Last fetched</th><th></th><th></th></tr></thead>
            <tbody>
              {leagueSources.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.divisionLabel}</td>
                  <td style={{ fontSize: 11.5, color: s.lastFetchError ? T.danger : T.inkSoft }}>
                    {s.lastFetchError ? `Error: ${s.lastFetchError}` : s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString("en-ZA") : "Not yet fetched"}
                  </td>
                  <td><button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => onEditLeagueSource(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function LeagueSourceModal({ source, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: source?.id || "",
    divisionLabel: source?.divisionLabel || "",
    sourceUrl: source?.sourceUrl || "",
    displayOrder: source?.displayOrder ?? 0,
  }));

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.divisionLabel.trim() || !form.sourceUrl.trim()) return;
    onSave(form);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{source ? "Edit division" : "Add division"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Division label</label>
            <input className="gfc-input" placeholder="e.g. Under 12 A" value={form.divisionLabel} onChange={(e) => update("divisionLabel", e.target.value)} required />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Standings URL</label>
            <input className="gfc-input" placeholder="https://cttfass.leaguerepublic.com/standingsForDate/..." value={form.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} required />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Display order <span style={{ fontWeight: 400, textTransform: "none", color: T.inkSoft }}>(lowest shows first)</span></label>
            <input type="number" className="gfc-input" value={form.displayOrder} onChange={(e) => update("displayOrder", e.target.value)} />
          </div>
          <div className="gfc-modal-actions">
            {source && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(source.id)}>
                Remove division
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
