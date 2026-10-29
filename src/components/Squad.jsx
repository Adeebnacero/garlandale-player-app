import React, { useState, useMemo, useEffect, useCallback } from "react";
import { T, STATUS_COLOR } from "../theme.js";
import { computeAgeGroup, yearsOfService } from "../lib/billing.js";
import { fmtMoney, fmtDate, todayISO } from "../lib/format.js";
import { filterStatsByAgeGroup } from "../lib/playerStats.js";
import { Badge, InactiveToggle } from "./shared.jsx";

// For coaches, the badge shows a simplified compliance view (documents only,
// no financial detail) - this keeps the hover tooltip consistent with that,
// rather than leaking a balance figure the badge itself doesn't show.
function badgeProps(p, hideFinancials) {
  if (hideFinancials && p.status !== "inactive") {
    const ok = p.documentsComplete;
    return { status: ok ? "green" : "red", reason: ok ? "Registration documents complete." : "Registration documents are incomplete." };
  }
  return { status: p.status, reason: p.reason };
}

export function SquadView({ filtered, ageGroups, ageFilter, setAgeFilter, statusFilter, setStatusFilter, search, setSearch, includeInactive, setIncludeInactive, role, onAdd, onEdit, onOpenLedger, playerStats, leagueSources, leagueStandings }) {
  const hideFinancials = role === "coach";
  const [viewMode, setViewMode] = useState("cards"); // 'cards', 'list', or 'stats'

  const filteredStats = useMemo(() => filterStatsByAgeGroup(playerStats, ageFilter), [playerStats, ageFilter]);

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Squad</div>
          <div className="gfc-page-sub">{filtered.length} player{filtered.length === 1 ? "" : "s"} shown</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <InactiveToggle includeInactive={includeInactive} setIncludeInactive={setIncludeInactive} />
          <button className="gfc-btn gfc-btn-primary" onClick={onAdd}>+ Add player</button>
        </div>
      </div>

      <div style={{
        display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 12,
        borderBottom: `1px solid ${T.line}`,
      }}>
        {ageGroups.map((g) => (
          <button
            key={g}
            onClick={() => setAgeFilter(g)}
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              color: ageFilter === g ? T.indigo : T.inkSoft,
              borderBottom: ageFilter === g ? `2.5px solid ${T.gold}` : "2.5px solid transparent",
              marginBottom: -9,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {g === "All" ? "All" : g}
          </button>
        ))}
      </div>

      <div className="gfc-filters" style={{ marginBottom: 16, justifyContent: "space-between" }}>
        <div className="gfc-filters">
          <input
            className="gfc-input"
            style={{ maxWidth: 220 }}
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="gfc-select" style={{ maxWidth: 170 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All compliance</option>
            <option value="green">Compliant</option>
            <option value="amber">Payment due</option>
            <option value="red">Non-compliant</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 4, background: T.paperDim, borderRadius: 8, padding: 3 }}>
          <button
            className="gfc-btn gfc-btn-sm"
            style={{ background: viewMode === "cards" ? "#fff" : "transparent", color: T.ink, boxShadow: viewMode === "cards" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
            onClick={() => setViewMode("cards")}
          >
            ▤ Cards
          </button>
          <button
            className="gfc-btn gfc-btn-sm"
            style={{ background: viewMode === "list" ? "#fff" : "transparent", color: T.ink, boxShadow: viewMode === "list" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
            onClick={() => setViewMode("list")}
          >
            ☰ List
          </button>
          <button
            className="gfc-btn gfc-btn-sm"
            style={{ background: viewMode === "stats" ? "#fff" : "transparent", color: T.ink, boxShadow: viewMode === "stats" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
            onClick={() => setViewMode("stats")}
          >
            🏆 Stats
          </button>
          <button
            className="gfc-btn gfc-btn-sm"
            style={{ background: viewMode === "league" ? "#fff" : "transparent", color: T.ink, boxShadow: viewMode === "league" ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
            onClick={() => setViewMode("league")}
          >
            📊 League Table
          </button>
        </div>
      </div>

      {viewMode === "league" ? (
        <div>
          {(!leagueSources || leagueSources.length === 0) ? (
            <div className="gfc-panel">
              <div className="gfc-empty">
                <div className="gfc-empty-title gfc-display">No league tables set up</div>
                Add the federation's standings URLs for each division in Settings.
              </div>
            </div>
          ) : (
            leagueSources.map((source) => {
              const rows = (leagueStandings || []).filter((s) => s.sourceId === source.id);
              return (
                <div key={source.id} className="gfc-panel" style={{ marginBottom: 16 }}>
                  <div className="gfc-panel-head"><div className="gfc-panel-title">{source.divisionLabel}</div></div>
                  {rows.length === 0 ? (
                    <div className="gfc-empty">Not fetched yet — check back after the next scheduled refresh.</div>
                  ) : (
                    <div className="gfc-scroll-wrap">
                    <table className="gfc-table">
                      <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>+/-</th><th>Pts</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} style={r.isGarlandale ? { background: T.amberSoft, fontWeight: 700 } : undefined}>
                            <td>{r.position}</td>
                            <td>{r.teamName}</td>
                            <td className="gfc-mono">{r.played}</td>
                            <td className="gfc-mono">{r.won}</td>
                            <td className="gfc-mono">{r.drawn}</td>
                            <td className="gfc-mono">{r.lost}</td>
                            <td className="gfc-mono">{r.goalsFor}</td>
                            <td className="gfc-mono">{r.goalsAgainst}</td>
                            <td className="gfc-mono">{r.goalDifference}</td>
                            <td className="gfc-mono" style={{ fontWeight: 700 }}>{r.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : viewMode === "stats" ? (
        <div className="gfc-panel">
          <div className="gfc-panel-head"><div className="gfc-panel-title">Season stats{ageFilter !== "All" ? ` — ${ageFilter}` : ""} ({filteredStats.length})</div></div>
          {filteredStats.length === 0 ? (
            <div className="gfc-empty">
              <div className="gfc-empty-title gfc-display">No stats recorded yet</div>
              Goals and assists are entered per player on the Matchday tab after each game.
            </div>
          ) : (
            <div className="gfc-scroll-wrap">
            <table className="gfc-table">
              <thead><tr><th>Player</th><th>Age group</th><th>Goals</th><th>Assists</th><th>G+A</th></tr></thead>
              <tbody>
                {filteredStats.map((s) => (
                  <tr key={s.playerId}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td><span className="gfc-agepill">{s.ageGroup}</span></td>
                    <td className="gfc-mono">{s.goals}</td>
                    <td className="gfc-mono">{s.assists}</td>
                    <td className="gfc-mono" style={{ fontWeight: 700 }}>{s.goalContributions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="gfc-panel">
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No players found</div>
            Try adjusting the filters, or add a new player to the squad.
          </div>
        </div>
      ) : viewMode === "cards" ? (
        <div className="gfc-scroll-wrap">
        <div className="gfc-squad-grid">
          {filtered.map((p) => (
            <div key={p.id} className="gfc-card" onClick={() => onEdit(p)}>
              <div className="gfc-card-ribbon" style={{ borderColor: `${STATUS_COLOR[p.status]} transparent transparent ${STATUS_COLOR[p.status]}` }} />
              <div className="gfc-card-name">{p.name}</div>
              <div className="gfc-card-meta">{p.phone || "No contact number"}</div>
              <div className="gfc-card-meta" style={{ marginTop: 2 }}>Joined {fmtDate(p.joinDate)}</div>
              <div className="gfc-card-meta" style={{ marginTop: 2, color: p.regNo ? T.inkSoft : T.amber, fontWeight: p.regNo ? 400 : 700 }}>
                {p.regNo ? `Reg No: ${p.regNo}` : "Pending federation number"}
              </div>
              <div className="gfc-card-foot">
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="gfc-agepill">{p.ageGroup}</span>
                </span>
                {!hideFinancials && (
                  <span className="gfc-card-balance" style={{ color: p.balance > 0 ? T.danger : T.green }}>
                    {p.balance > 0 ? fmtMoney(p.balance) + " due" : "Paid up"}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Badge {...badgeProps(p, hideFinancials)} />
                {!hideFinancials && (
                  <button
                    className="gfc-btn gfc-btn-ghost gfc-btn-sm"
                    onClick={(e) => { e.stopPropagation(); onOpenLedger(p); }}
                  >
                    View ledger →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      ) : (
        <div className="gfc-panel">
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age group</th>
                <th>Reg no</th>
                <th>Phone</th>
                {!hideFinancials && <th>Tier</th>}
                {!hideFinancials && <th>Balance</th>}
                <th>Compliance</th>
                {!hideFinancials && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => onEdit(p)}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>
                    <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <span className="gfc-agepill">{p.ageGroup}</span>
                    </span>
                  </td>
                  <td style={{ color: p.regNo ? T.ink : T.amber, fontWeight: p.regNo ? 400 : 700 }}>{p.regNo || "Pending"}</td>
                  <td>{p.phone || "—"}</td>
                  {!hideFinancials && <td>{p.tierName || <span style={{ color: T.amber, fontWeight: 700 }}>No tier</span>}</td>}
                  {!hideFinancials && <td className="gfc-mono" style={{ fontWeight: 700, color: p.balance > 0 ? T.danger : T.green }}>{fmtMoney(p.balance)}</td>}
                  <td><Badge {...badgeProps(p, hideFinancials)} /></td>
                  {!hideFinancials && (
                    <td>
                      <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); onOpenLedger(p); }}>Ledger</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- PLAYER MODAL (add/edit) ---------- */

// The player-facing app is paused for now - flip this back to true to
// restore the "App account" invite/resend section on a player's profile.
// Nothing else needs to change: guardian_players, current_player_ids(),
// and the invite-player / manage-player-guardians Edge Functions all stay
// in place either way.
const PLAYER_APP_INVITE_ENABLED = true;

export function PlayerModal({ player, tiers, onClose, onSave, onDelete, onManageTiers, onInvitePlayer, onListGuardians, onRemoveGuardian }) {
  const [form, setForm] = useState(() => ({
    id: player?.id || "",
    name: player?.name || "",
    dob: player?.dob || "",
    ageGroupOverride: player?.ageGroupOverride || "",
    phone: player?.phone || "",
    email: player?.email || "",
    guardianName: player?.guardianName || "",
    guardianPhone: player?.guardianPhone || "",
    joinDate: player?.joinDate || todayISO(),
    billingStartDate: player?.billingStartDate || "",
    tierId: player?.tierId || "",
    documentsComplete: player?.documentsComplete ?? false,
    notes: player?.notes || "",
    regNo: player?.regNo || "",
    squadNumber: player?.squadNumber ?? "",
    active: player?.active ?? true,
  }));
  const [regNoError, setRegNoError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setRegNoError("");
    const err = await onSave(form);
    if (err) setRegNoError(err);
  }

  const previewAgeGroup = form.ageGroupOverride || computeAgeGroup(form.dob);

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{player ? "Edit player" : "Add player"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        {player && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: form.active ? T.greenSoft : T.paperDim, border: `1px solid ${form.active ? T.green : T.line}`,
            borderRadius: 8, padding: "10px 14px", marginBottom: 16,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: form.active ? T.green : T.inkSoft }}>
                {form.active ? "Active player" : "Inactive player"}
              </div>
              <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>
                {form.active ? "Subscription fees accrue normally." : "No subscription fees accrue while inactive."}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => update("active", e.target.checked)} />
              {form.active ? "Mark inactive" : "Mark active"}
            </label>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Full name</label>
            <input className="gfc-input" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Date of birth</label>
              <input type="date" className="gfc-input" value={form.dob} onChange={(e) => update("dob", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Age group {form.dob && <span style={{ color: T.inkSoft, fontWeight: 400, textTransform: "none" }}>(auto: {computeAgeGroup(form.dob)})</span>}</label>
              <input className="gfc-input" placeholder="Override e.g. U11" value={form.ageGroupOverride} onChange={(e) => update("ageGroupOverride", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Player phone</label>
              <input className="gfc-input" placeholder="+27 82 000 0000" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Email</label>
              <input type="email" className="gfc-input" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Guardian name</label>
              <input className="gfc-input" value={form.guardianName} onChange={(e) => update("guardianName", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Guardian phone</label>
              <input className="gfc-input" placeholder="Used for messages if set" value={form.guardianPhone} onChange={(e) => update("guardianPhone", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Club join date <span style={{ fontWeight: 400, textTransform: "none", color: T.inkSoft }}>(tenure/service record)</span></label>
              <input type="date" className="gfc-input" value={form.joinDate} onChange={(e) => update("joinDate", e.target.value)} />
              {form.joinDate && (
                <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>{yearsOfService(form.joinDate)} of service</div>
              )}
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Billing start date <span style={{ fontWeight: 400, textTransform: "none", color: T.inkSoft }}>(optional)</span></label>
              <input type="date" className="gfc-input" placeholder="Same as join date" value={form.billingStartDate} onChange={(e) => update("billingStartDate", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Subscription tier</label>
              <select className="gfc-select" value={form.tierId} onChange={(e) => update("tierId", e.target.value)}>
                <option value="">No tier assigned</option>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — {fmtMoney(t.monthlyFee)}/mo</option>)}
              </select>
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" style={{ paddingLeft: 0, marginTop: 4 }} onClick={onManageTiers}>Manage tiers →</button>
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Federation reg. no</label>
              <input
                className="gfc-input"
                placeholder="Assigned once federation registers player"
                value={form.regNo}
                onChange={(e) => { update("regNo", e.target.value); setRegNoError(""); }}
              />
              {regNoError && <div style={{ color: T.danger, fontSize: 11.5, marginTop: 4 }}>{regNoError}</div>}
              {!form.regNo && !regNoError && (
                <div style={{ color: T.amber, fontSize: 11.5, marginTop: 4 }}>Pending federation number</div>
              )}
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Usual squad number</label>
              <input type="number" min="0" className="gfc-input" placeholder="e.g. 9" value={form.squadNumber} onChange={(e) => update("squadNumber", e.target.value)} />
            </div>
          </div>

          <div className="gfc-field gfc-check-row">
            <input type="checkbox" id="docs" checked={form.documentsComplete} onChange={(e) => update("documentsComplete", e.target.checked)} />
            <label htmlFor="docs">Registration paperwork / medical form complete</label>
          </div>

          <div className="gfc-field">
            <label className="gfc-label">Notes</label>
            <textarea className="gfc-textarea" rows={2} value={form.notes} onChange={(e) => update("notes", e.target.value)} />
          </div>

          <div style={{ fontSize: 11.5, color: T.inkSoft }}>
            Will appear under <span className="gfc-agepill" style={{ marginLeft: 4 }}>{previewAgeGroup}</span>
          </div>

          {PLAYER_APP_INVITE_ENABLED && player && (
            <AppAccessPanel
              player={player}
              onInvite={onInvitePlayer}
              onList={onListGuardians}
              onRemove={onRemoveGuardian}
            />
          )}

          <div className="gfc-modal-actions">
            {player && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(player.id)}>
                Remove player
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save player</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- APP ACCESS PANEL (inside PlayerModal) ---------- */

// Keep in sync with MAX_ACCOUNTS_PER_PLAYER in the invite-player Edge
// Function. The function is what actually enforces the limit; this only
// hides the invite box once the limit is reached.
const MAX_APP_ACCOUNTS_PER_PLAYER = 2;

// Shows every Player Portal login linked to this player (typically one or
// two guardians), whether each has activated their account, and lets staff
// resend, add another guardian, or remove a login's access.
function AppAccessPanel({ player, onInvite, onList, onRemove }) {
  const [accounts, setAccounts] = useState(null); // null = loading
  const [loadError, setLoadError] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(""); // "" | "invite" | authUserId | email
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!onList) { setAccounts([]); return; }
    const res = await onList(player.id);
    if (res?.error) { setLoadError(res.error); setAccounts([]); }
    else { setLoadError(""); setAccounts(res.accounts); }
  }, [onList, player.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Pre-fill the invite box with the player's own email only when nobody
  // is linked yet - for a second guardian it's always a different address.
  useEffect(() => {
    if (accounts && accounts.length === 0 && !newEmail) setNewEmail(player.email || "");
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  function describeInviteResult(email, result) {
    if (result?.error) return result.error;
    if (result.emailSent) return `Invite email sent to ${email}.`;
    if (result.emailError) return `Linked ${email}, but the invite email couldn't be sent (${result.emailError}). Try resending, or check the SMTP setup in Settings.`;
    if (result.alreadyRegistered) return `${email} already has an app login, so no email was needed - they'll see ${player.name} next time they open the app.`;
    return `Linked ${email}.`;
  }

  async function sendInvite(email, busyKey) {
    const clean = email.trim();
    if (!clean) { setMessage("Enter an email address first."); return; }
    setBusy(busyKey);
    setMessage("");
    const result = await onInvite(player.id, clean);
    setMessage(describeInviteResult(clean, result));
    if (!result?.error && busyKey === "invite") setNewEmail("");
    await refresh();
    setBusy("");
  }

  async function removeAccount(acc) {
    const ok = window.confirm(
      `Remove ${acc.email}'s access to ${player.name} in the Player Portal?\n\n` +
      "Their login is kept, so any other children linked to it are unaffected."
    );
    if (!ok) return;
    setBusy(acc.authUserId);
    setMessage("");
    const result = await onRemove(player.id, acc.authUserId);
    setMessage(result?.error ? result.error : `Removed ${acc.email}.`);
    await refresh();
    setBusy("");
  }

  const atLimit = accounts && accounts.length >= MAX_APP_ACCOUNTS_PER_PLAYER;

  return (
    <div style={{ marginTop: 16, background: T.paperDim, border: `1px solid ${T.line}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.indigo, marginBottom: 4 }}>
        App access
      </div>
      <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 10 }}>
        Up to {MAX_APP_ACCOUNTS_PER_PLAYER} logins can see this player in the Player Portal - for example, each parent on their own email.
      </div>

      {accounts === null && <div style={{ fontSize: 12, color: T.inkSoft }}>Loading linked accounts…</div>}
      {loadError && <div style={{ fontSize: 12, color: T.danger, fontWeight: 600, marginBottom: 8 }}>{loadError}</div>}

      {accounts && accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {accounts.map((acc) => (
            <div key={acc.authUserId} style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              background: "#fff", border: `1px solid ${T.line}`, borderRadius: 6, padding: "8px 10px",
            }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, wordBreak: "break-all" }}>{acc.email}</div>
                <div style={{ fontSize: 11, color: acc.activated ? T.green : T.inkSoft, marginTop: 2 }}>
                  {acc.activated
                    ? (acc.lastSignInAt ? `Active · last signed in ${fmtDate(acc.lastSignInAt.slice(0, 10))}` : "Active")
                    : "Invite sent · not accepted yet"}
                </div>
              </div>
              {!acc.activated && (
                <button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm"
                  disabled={!!busy} onClick={() => sendInvite(acc.email, acc.email)}>
                  {busy === acc.email ? "Sending…" : "Resend"}
                </button>
              )}
              {onRemove && (
                <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm"
                  disabled={!!busy} onClick={() => removeAccount(acc)}>
                  {busy === acc.authUserId ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {accounts && !atLimit && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="gfc-input"
            style={{ flex: 1 }}
            type="email"
            placeholder={accounts.length === 0 ? "guardian@email.com" : "second guardian's email"}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button type="button" className="gfc-btn gfc-btn-outline" disabled={!!busy} onClick={() => sendInvite(newEmail, "invite")}>
            {busy === "invite" ? "Sending…" : accounts.length === 0 ? "Send app invite" : "Add guardian"}
          </button>
        </div>
      )}
      {atLimit && (
        <div style={{ fontSize: 11.5, color: T.inkSoft }}>
          Maximum reached. Remove an account above to invite someone else.
        </div>
      )}

      {message && (
        <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8, fontWeight: 600 }}>{message}</div>
      )}
    </div>
  );
}
