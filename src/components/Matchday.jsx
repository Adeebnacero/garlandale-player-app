import React, { useState, useMemo } from "react";
import { T } from "../theme.js";
import { fmtDate, todayISO } from "../lib/format.js";
import { printTeamSheet } from "../lib/teamSheet.js";
import { computeMonthOptions, computeMonthRange } from "../lib/dateCascade.js";
import { usePagination, Pagination, LocationFields } from "./shared.jsx";
import { checkLocationFields } from "../lib/mapLinks.js";

export function MatchdayView({ matches, enriched, ageGroups, activeMatchId, setActiveMatchId, squad, onAddMatch, onEditMatch, onSetSlot, onUpdateJersey, onUpdateStats, fixtures, staffList, onSyncFixtures }) {
  const activeMatch = matches.find((m) => m.id === activeMatchId) || null;
  const [rosterAgeFilter, setRosterAgeFilter] = useState("All");

  // Read-only lookup of who's been appointed to referee the active match,
  // sourced from the fixture it was created from (Fixtures tab is where
  // that assignment is actually made). Deliberately separate from the
  // free-text "Referee" field inside Edit fixture below, which is filled
  // in by hand from what's on the paper team sheet on the day and may not
  // match the appointment (a late substitute referee, for example).
  const assignedRefereeEmail = useMemo(() => {
    if (!activeMatch?.fixtureId) return "";
    const fixture = (fixtures || []).find((f) => f.id === activeMatch.fixtureId);
    if (!fixture?.refereeId) return "";
    const referee = (staffList || []).find((s) => s.id === fixture.refereeId);
    return referee?.email || "";
  }, [activeMatch, fixtures, staffList]);

  const [windowDays, setWindowDays] = useState(7);
  const [selectedFixtureIds, setSelectedFixtureIds] = useState(() => new Set());
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [panelExpanded, setPanelExpanded] = useState(false);

  const linkedFixtureIds = useMemo(() => new Set(matches.map((m) => m.fixtureId).filter(Boolean)), [matches]);

  const [monthFilter, setMonthFilter] = useState("all");
  const monthOptions = useMemo(() => computeMonthOptions(matches, (m) => m.matchDate), [matches]);
  const filteredMatches = useMemo(() => {
    if (monthFilter === "all") return matches;
    const [year, month] = monthFilter.split("-").map(Number);
    const { start, end } = computeMonthRange(year, month);
    return matches.filter((m) => {
      if (!m.matchDate) return false;
      const d = new Date(m.matchDate);
      return !isNaN(d.getTime()) && d >= start && d <= end;
    });
  }, [matches, monthFilter]);
  const { page, setPage, totalPages, pageItems } = usePagination(filteredMatches, { pageSize: 10, resetKey: monthFilter });

  const eligibleFixtures = useMemo(() => {
    const today = todayISO();
    const cutoff = windowDays === 0 ? null : new Date(Date.now() + windowDays * 86400000).toISOString().slice(0, 10);
    return (fixtures || [])
      .filter((f) => f.matchDate >= today && (!cutoff || f.matchDate <= cutoff))
      .sort((a, b) => (a.matchDate + (a.kickoffTime || "")).localeCompare(b.matchDate + (b.kickoffTime || "")));
  }, [fixtures, windowDays]);

  const eligiblePagination = usePagination(eligibleFixtures, { pageSize: 10, resetKey: windowDays });

  function toggleFixture(id) {
    setSelectedFixtureIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSync() {
    if (selectedFixtureIds.size === 0) return;
    setSyncBusy(true);
    setSyncMessage("");
    const result = await onSyncFixtures(Array.from(selectedFixtureIds));
    if (result?.error) {
      setSyncMessage(result.error);
    } else {
      const parts = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.updated) parts.push(`${result.updated} updated`);
      setSyncMessage(parts.length ? `Done — ${parts.join(", ")}.` : "No changes made.");
      setSelectedFixtureIds(new Set());
    }
    setSyncBusy(false);
  }

  const rosterPool = useMemo(() => {
    return enriched.filter((p) => rosterAgeFilter === "All" || p.ageGroup === rosterAgeFilter);
  }, [enriched, rosterAgeFilter]);

  const takenPlayerIds = new Set(squad.map((r) => r.playerId));

  function slotRow(slotNo, role) {
    const row = squad.find((r) => r.slotNo === slotNo);
    return (
      <div key={slotNo} className="gfc-send-row" style={{ gap: 8 }}>
        <div style={{ width: 22, fontWeight: 700, color: T.inkSoft }}>{slotNo}</div>
        <select
          className="gfc-select"
          style={{ flex: 1 }}
          value={row?.playerId || ""}
          onChange={(e) => {
            const player = enriched.find((p) => p.id === e.target.value) || null;
            onSetSlot(activeMatch.id, slotNo, role, player);
          }}
        >
          <option value="">— empty —</option>
          {rosterPool
            .filter((p) => p.id === row?.playerId || !takenPlayerIds.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.regNo ? "" : " (no reg no)"}</option>
            ))}
        </select>
        <input
          className="gfc-input"
          style={{ width: 60, textAlign: "center" }}
          placeholder="No."
          value={row?.jerseyNo || ""}
          disabled={!row}
          onChange={(e) => row && onUpdateJersey(activeMatch.id, row.id, e.target.value)}
        />
        <input
          type="number"
          min="0"
          className="gfc-input"
          style={{ width: 48, textAlign: "center" }}
          title="Goals scored"
          placeholder="G"
          value={row ? row.goals || "" : ""}
          disabled={!row}
          onChange={(e) => row && onUpdateStats(activeMatch.id, row.id, "goals", e.target.value)}
        />
        <input
          type="number"
          min="0"
          className="gfc-input"
          style={{ width: 48, textAlign: "center" }}
          title="Assists"
          placeholder="A"
          value={row ? row.assists || "" : ""}
          disabled={!row}
          onChange={(e) => row && onUpdateStats(activeMatch.id, row.id, "assists", e.target.value)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Matchday</div>
          <div className="gfc-page-sub">Build your squad and print the official team sheet</div>
        </div>
        <button className="gfc-btn gfc-btn-primary" onClick={onAddMatch}>+ New fixture</button>
      </div>

      <div className="gfc-panel" style={{ padding: 16, marginBottom: 18 }}>
        <div className="gfc-panel-head" style={{ marginBottom: panelExpanded ? 8 : 0, cursor: "pointer" }} onClick={() => setPanelExpanded((v) => !v)}>
          <div className="gfc-panel-title">
            {panelExpanded ? "▾" : "▸"} Create from Fixtures
            {!panelExpanded && eligibleFixtures.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 400, color: T.inkSoft, textTransform: "none" }}>
                {eligibleFixtures.length} fixture{eligibleFixtures.length === 1 ? "" : "s"} in the next {windowDays || "∞"} days
              </span>
            )}
          </div>
          {panelExpanded && (
            <select
              className="gfc-select"
              style={{ maxWidth: 160 }}
              value={windowDays}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              <option value={7}>Next 7 days</option>
              <option value={14}>Next 14 days</option>
              <option value={30}>Next 30 days</option>
              <option value={0}>All upcoming</option>
            </select>
          )}
        </div>
        {panelExpanded && (
          <>
        <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 10 }}>
          Select fixtures to create a Matchday entry (or refresh one that already exists) — opponent, date, time, venue, and age group are filled in automatically; everything else stays blank for you to complete, same as adding one manually.
        </div>
        {eligibleFixtures.length === 0 ? (
          <div className="gfc-empty">No fixtures in this window. Import them in the Fixtures tab, or widen the window above.</div>
        ) : (
          <>
            <div className="gfc-checklist" style={{ marginBottom: 10 }}>
              {eligiblePagination.pageItems.map((f) => (
                <label key={f.id} className="gfc-checklist-row" style={{ cursor: "pointer" }}>
                  <span className="gfc-checklist-left">
                    <input type="checkbox" checked={selectedFixtureIds.has(f.id)} onChange={() => toggleFixture(f.id)} />
                    <span>
                      {fmtDate(f.matchDate)} — <strong>{f.squadAgeGroup || f.teamLabel || f.divisionKey}</strong> vs {f.opponent}
                    </span>
                  </span>
                  {linkedFixtureIds.has(f.id) ? (
                    <span style={{ fontSize: 11, color: T.inkSoft }}>Already linked — will refresh</span>
                  ) : (
                    <span style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>New</span>
                  )}
                </label>
              ))}
            </div>
            <Pagination
              page={eligiblePagination.page}
              setPage={eligiblePagination.setPage}
              totalPages={eligiblePagination.totalPages}
              totalItems={eligibleFixtures.length}
              pageSize={10}
            />
            <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={handleSync} disabled={syncBusy || selectedFixtureIds.size === 0}>
              {syncBusy ? "Working…" : `Create/update ${selectedFixtureIds.size || ""} selected`}
            </button>
            {syncMessage && <span style={{ marginLeft: 10, fontSize: 12, color: T.inkSoft, fontWeight: 600 }}>{syncMessage}</span>}
          </>
        )}
          </>
        )}
      </div>

      <div className="gfc-row2" style={{ alignItems: "flex-start", gridTemplateColumns: "260px 1fr" }}>
        <div className="gfc-panel" style={{ padding: 0 }}>
          <div className="gfc-panel-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div className="gfc-panel-title">Fixtures</div>
            {monthOptions.length > 0 && (
              <select className="gfc-select" style={{ width: "100%" }} value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="all">All fixtures</option>
                {monthOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            )}
          </div>
          {matches.length === 0 ? (
            <div className="gfc-empty">No fixtures yet. Add one to get started.</div>
          ) : filteredMatches.length === 0 ? (
            <div className="gfc-empty">No fixtures in this month.</div>
          ) : (
            <div>
              {pageItems.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setActiveMatchId(m.id)}
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${T.line}`,
                    cursor: "pointer",
                    background: activeMatchId === m.id ? T.paperDim : "transparent",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>vs {m.opponent || "TBC"}</div>
                  <div style={{ fontSize: 11.5, color: T.inkSoft }}>{fmtDate(m.matchDate)} · {m.homeAway === "H" ? "Home" : "Away"}</div>
                  {m.ageGroup && <span className="gfc-agepill" style={{ marginTop: 4, display: "inline-block" }}>{m.ageGroup}</span>}
                </div>
              ))}
            </div>
          )}
          <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={filteredMatches.length} pageSize={10} />
        </div>

        {!activeMatch ? (
          <div className="gfc-panel">
            <div className="gfc-empty">
              <div className="gfc-empty-title gfc-display">No fixture selected</div>
              Choose a fixture on the left, or create a new one, to build a squad.
            </div>
          </div>
        ) : (
          <div>
            <div className="gfc-panel" style={{ marginBottom: 14 }}>
              <div className="gfc-panel-head">
                <div>
                  <div className="gfc-panel-title">{activeMatch.homeAway === "H" ? "Garlandale FC (H)" : `${activeMatch.opponent || "Opponent"} (H)`} vs {activeMatch.homeAway === "H" ? (activeMatch.opponent || "Opponent") : "Garlandale FC"} (A)</div>
                  <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                    {fmtDate(activeMatch.matchDate)} {activeMatch.kickoffTime ? `· ${activeMatch.kickoffTime}` : ""} · {activeMatch.division || "Division TBC"} · {activeMatch.competition || "Competition TBC"}
                  </div>
                  {assignedRefereeEmail && (
                    <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4 }}>
                      Referee appointed: <strong>{assignedRefereeEmail}</strong>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => onEditMatch(activeMatch)}>Edit fixture</button>
                  <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={() => printTeamSheet(activeMatch, squad, enriched)}>Print team sheet</button>
                </div>
              </div>
            </div>

            <div className="gfc-row2">
              <div className="gfc-panel" style={{ padding: 16 }}>
                <div className="gfc-panel-title" style={{ marginBottom: 10 }}>Starting XI</div>
                <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 8 }}>No. = jersey number · G = goals · A = assists</div>
                <div className="gfc-filters" style={{ marginBottom: 10 }}>
                  <select className="gfc-select" style={{ maxWidth: 160 }} value={rosterAgeFilter} onChange={(e) => setRosterAgeFilter(e.target.value)}>
                    {ageGroups.map((g) => <option key={g} value={g}>{g === "All" ? "All age groups" : g}</option>)}
                  </select>
                </div>
                <div className="gfc-checklist" style={{ maxHeight: "none" }}>
                  {Array.from({ length: 11 }, (_, i) => slotRow(i + 1, "starting"))}
                </div>
              </div>
              <div className="gfc-panel" style={{ padding: 16 }}>
                <div className="gfc-panel-title" style={{ marginBottom: 10 }}>Substitutes</div>
                <div style={{ height: 38 }} />
                <div className="gfc-checklist" style={{ maxHeight: "none" }}>
                  {Array.from({ length: 9 }, (_, i) => slotRow(i + 12, "sub"))}
                </div>
              </div>
            </div>

            {squad.some((r) => r.player && !r.player.regNo) && (
              <div style={{ background: T.amberSoft, border: `1px solid ${T.gold}`, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#7a5410", marginTop: 14 }}>
                <strong>Heads up:</strong> at least one selected player doesn't have a federation registration number on file yet — worth confirming eligibility before matchday.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


export function MatchModal({ match, players, ageGroups, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: match?.id || "",
    leagueName: match?.leagueName || "Cape Town Tygerberg LFA",
    homeTeam: match?.homeTeam || "Garlandale FC",
    opponent: match?.opponent || "",
    homeAway: match?.homeAway || "H",
    venue: match?.venue || "",
    matchDate: match?.matchDate || todayISO(),
    kickoffTime: match?.kickoffTime || "",
    division: match?.division || "",
    competition: match?.competition || "",
    ageGroup: match?.ageGroup || "",
    cornerFlags: match?.cornerFlags || "",
    fieldConditions: match?.fieldConditions || "",
    fieldMarking: match?.fieldMarking || "",
    firstAidPresent: match?.firstAidPresent || "",
    refereeName: match?.refereeName || "",
    assistantRef1: match?.assistantRef1 || "",
    assistantRef2: match?.assistantRef2 || "",
    coachName: match?.coachName || "",
    coachRegNo: match?.coachRegNo || "",
    managerName: match?.managerName || "",
    managerRegNo: match?.managerRegNo || "",
    captainPlayerId: match?.captainPlayerId || "",
    physioName: match?.physioName || "",
    physioRegNo: match?.physioRegNo || "",
    comments: match?.comments || "",
    fullTimeScoreHome: match?.fullTimeScoreHome || "",
    fullTimeScoreAway: match?.fullTimeScoreAway || "",
    locationLink: match?.locationLink || "",
    locationEmbed: match?.locationEmbed || "",
  }));
  const [locationError, setLocationError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.opponent.trim()) return;
    const loc = checkLocationFields(form);
    if (!loc.ok) {
      setLocationError(loc.errors.link || loc.errors.embed);
      return;
    }
    setLocationError("");
    onSave({ ...form, locationLink: loc.locationLink, locationEmbed: loc.locationEmbed });
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{match ? "Edit fixture" : "New fixture"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Opponent</label>
              <input className="gfc-input" value={form.opponent} onChange={(e) => update("opponent", e.target.value)} required />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Home / Away</label>
              <select className="gfc-select" value={form.homeAway} onChange={(e) => update("homeAway", e.target.value)}>
                <option value="H">Home</option>
                <option value="A">Away</option>
              </select>
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Date</label>
              <input type="date" className="gfc-input" value={form.matchDate} onChange={(e) => update("matchDate", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Kick-off time</label>
              <input type="time" className="gfc-input" value={form.kickoffTime} onChange={(e) => update("kickoffTime", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Venue &amp; field</label>
              <input className="gfc-input" value={form.venue} onChange={(e) => update("venue", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Age group</label>
              <select className="gfc-select" value={form.ageGroup} onChange={(e) => update("ageGroup", e.target.value)}>
                <option value="">Not set</option>
                {ageGroups.filter((g) => g !== "All").map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <LocationFields link={form.locationLink} embed={form.locationEmbed} onChange={update} />

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Full-time score — Garlandale</label>
              <input type="number" min="0" className="gfc-input" placeholder="e.g. 3" value={form.homeAway === "H" ? form.fullTimeScoreHome : form.fullTimeScoreAway} onChange={(e) => update(form.homeAway === "H" ? "fullTimeScoreHome" : "fullTimeScoreAway", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Full-time score — {form.opponent || "Opponent"}</label>
              <input type="number" min="0" className="gfc-input" placeholder="e.g. 1" value={form.homeAway === "H" ? form.fullTimeScoreAway : form.fullTimeScoreHome} onChange={(e) => update(form.homeAway === "H" ? "fullTimeScoreAway" : "fullTimeScoreHome", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Division</label>
              <input className="gfc-input" value={form.division} onChange={(e) => update("division", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Competition</label>
              <input className="gfc-input" value={form.competition} onChange={(e) => update("competition", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Referee</label>
              <input className="gfc-input" value={form.refereeName} onChange={(e) => update("refereeName", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">League / association name</label>
              <input className="gfc-input" value={form.leagueName} onChange={(e) => update("leagueName", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Coach name</label>
              <input className="gfc-input" value={form.coachName} onChange={(e) => update("coachName", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Coach reg. no</label>
              <input className="gfc-input" value={form.coachRegNo} onChange={(e) => update("coachRegNo", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Manager name</label>
              <input className="gfc-input" value={form.managerName} onChange={(e) => update("managerName", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Manager reg. no</label>
              <input className="gfc-input" value={form.managerRegNo} onChange={(e) => update("managerRegNo", e.target.value)} />
            </div>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Physio / first aider</label>
              <input className="gfc-input" value={form.physioName} onChange={(e) => update("physioName", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Physio reg. no</label>
              <input className="gfc-input" value={form.physioRegNo} onChange={(e) => update("physioRegNo", e.target.value)} />
            </div>
          </div>

          <div className="gfc-field">
            <label className="gfc-label">Captain</label>
            <select className="gfc-select" value={form.captainPlayerId} onChange={(e) => update("captainPlayerId", e.target.value)}>
              <option value="">Not set</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Corner flags (Yes/No)</label>
              <input className="gfc-input" value={form.cornerFlags} onChange={(e) => update("cornerFlags", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">First aid present (Yes/No)</label>
              <input className="gfc-input" value={form.firstAidPresent} onChange={(e) => update("firstAidPresent", e.target.value)} />
            </div>
          </div>

          <div className="gfc-field">
            <label className="gfc-label">Comments</label>
            <textarea className="gfc-textarea" rows={2} value={form.comments} onChange={(e) => update("comments", e.target.value)} />
          </div>

          {locationError && <div style={{ fontSize: 12, color: T.danger, fontWeight: 600, marginBottom: 10 }}>{locationError}</div>}
          <div className="gfc-modal-actions">
            {match && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(match.id)}>
                Delete fixture
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save fixture</button>
          </div>
        </form>
      </div>
    </div>
  );
}
