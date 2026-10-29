import React, { useState } from "react";
import { T } from "../theme.js";
import { fmtDate } from "../lib/format.js";

export const ROLE_LABEL = { admin: "Admin", treasurer: "Treasurer", coach: "Coach", referee: "Referee", chairman: "Chairman" };

export function UsersView({ staffList, onInvite, onRemove, busy, message, staffTeams, ageGroups, onSaveStaffTeams }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("coach");
  const [editingTeamsFor, setEditingTeamsFor] = useState(null); // a staff row, or null

  function handleInvite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    onInvite(email.trim(), role);
    setEmail("");
  }

  function teamsFor(staffMemberId) {
    return (staffTeams || []).filter((t) => t.staffId === staffMemberId).map((t) => t.ageGroup);
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Users</div>
          <div className="gfc-page-sub">Invite staff and control who can access what</div>
        </div>
      </div>

      <div className="gfc-panel" style={{ padding: 20, marginBottom: 18 }}>
        <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Invite someone new</div>
        <form onSubmit={handleInvite} className="gfc-row2" style={{ gridTemplateColumns: "2fr 1fr auto", alignItems: "end", gap: 10 }}>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Email address</label>
            <input type="email" className="gfc-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="gfc-field" style={{ marginBottom: 0 }}>
            <label className="gfc-label">Role</label>
            <select className="gfc-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin (full access)</option>
              <option value="treasurer">Treasurer (financial only)</option>
              <option value="coach">Coach (squad/matchday/kit only)</option>
              <option value="referee">Referee (fixtures only)</option>
              <option value="chairman">Chairman (full access, same as Admin)</option>
            </select>
          </div>
          <button type="submit" className="gfc-btn gfc-btn-primary" disabled={busy}>{busy ? "Sending…" : "Send invite"}</button>
        </form>
        {message && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: message.toLowerCase().startsWith("failed") ? T.danger : T.green, fontWeight: 600 }}>
            {message}
          </div>
        )}
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head"><div className="gfc-panel-title">Current staff ({staffList.length})</div></div>
        {staffList.length === 0 ? (
          <div className="gfc-empty">No staff invited yet.</div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead><tr><th>Email</th><th>Role</th><th>Teams</th><th>Invited</th><th></th></tr></thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.email}</td>
                  <td><span className="gfc-agepill">{ROLE_LABEL[s.role] || s.role}</span></td>
                  <td style={{ fontSize: 12 }}>
                    {s.role === "coach" ? (
                      <>
                        {teamsFor(s.id).length > 0 ? teamsFor(s.id).join(", ") : <span style={{ color: T.inkSoft }}>None assigned</span>}
                        {" "}
                        <button className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => setEditingTeamsFor(s)}>Edit</button>
                      </>
                    ) : s.role === "referee" ? (
                      <span style={{ color: T.inkSoft }}>N/A</span>
                    ) : (
                      <span style={{ color: T.inkSoft }}>All (not restricted)</span>
                    )}
                  </td>
                  <td>{fmtDate(s.invited_at)}</td>
                  <td><button className="gfc-btn gfc-btn-danger gfc-btn-sm" onClick={() => onRemove(s.id)} disabled={busy}>Remove access</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {editingTeamsFor && (
        <TeamAssignmentModal
          staffMember={editingTeamsFor}
          currentTeams={teamsFor(editingTeamsFor.id)}
          ageGroups={ageGroups}
          onClose={() => setEditingTeamsFor(null)}
          onSave={onSaveStaffTeams}
        />
      )}
    </div>
  );
}

function TeamAssignmentModal({ staffMember, currentTeams, ageGroups, onClose, onSave }) {
  const [selected, setSelected] = useState(() => new Set(currentTeams));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const realAgeGroups = (ageGroups || []).filter((g) => g !== "All");

  function toggle(g) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    setError("");
    const result = await onSave(staffMember.id, Array.from(selected));
    if (result?.error) setError(result.error);
    else onClose();
    setBusy(false);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">Teams — {staffMember.email}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 12 }}>
          Which age group(s) can this coach post notices to? They'll only ever be able to target their own assigned team(s) — never "All players" or another coach's team.
        </div>
        {realAgeGroups.length === 0 ? (
          <div className="gfc-empty">No age groups yet — add players first.</div>
        ) : (
          <div className="gfc-checklist" style={{ marginBottom: 14 }}>
            {realAgeGroups.map((g) => (
              <label key={g} className="gfc-checklist-row" style={{ cursor: "pointer" }}>
                <span className="gfc-checklist-left">
                  <input type="checkbox" checked={selected.has(g)} onChange={() => toggle(g)} />
                  {g}
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: T.danger, fontWeight: 600, marginBottom: 10 }}>{error}</div>}
        <div className="gfc-modal-actions">
          <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="gfc-btn gfc-btn-primary" onClick={handleSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
