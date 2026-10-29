import React, { useState, useMemo, useRef } from "react";
import { T } from "../theme.js";
import { fmtDate, todayISO } from "../lib/format.js";
import {
  parseFederationWorkbook,
  extractGarlandaleFixtures,
  findUnmappedDivisions,
  formatDisplayTime,
} from "../lib/fixtureImport.js";
import { MONTH_NAMES, computeAvailableYears, filterByMonth } from "../lib/dateCascade.js";
import { usePagination, Pagination, LocationFields } from "./shared.jsx";
import { checkLocationFields } from "../lib/mapLinks.js";

function cleanDivisionGuess(text) {
  return String(text || "").replace(/^[A-Za-z0-9]+\s*-\s*/, "").trim();
}

export function FixturesView({ fixtures, divisionLabels, role, ageGroups, staffList, onImportFixtures, onSaveDivisionLabel, onSaveFixture, onDeleteFixture }) {
  const canImport = role === "admin" || role === "treasurer";
  const fileInputRef = useRef(null);
  const [editingFixture, setEditingFixture] = useState(null); // fixture row, or "new", or null

  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [pendingUnmapped, setPendingUnmapped] = useState([]);
  const [pendingLabels, setPendingLabels] = useState({}); // division -> { teamLabel, squadAgeGroup }
  const [pendingFixtures, setPendingFixtures] = useState(null);

  const today = useMemo(() => new Date(), []);
  const [dateFilter, setDateFilter] = useState("upcoming"); // "upcoming" | "month" | "all"
  const [selectedYear, setSelectedYear] = useState(today.getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getUTCMonth());
  const [teamFilter, setTeamFilter] = useState("All");
  const [refereeFilter, setRefereeFilter] = useState("All");

  const availableYears = useMemo(() => computeAvailableYears(fixtures, (f) => f.matchDate, today), [fixtures, today]);

  const refereeOptions = useMemo(() => (staffList || []).filter((s) => s.role === "referee"), [staffList]);
  const refereeEmailById = useMemo(() => {
    const map = {};
    refereeOptions.forEach((r) => { map[r.id] = r.email; });
    return map;
  }, [refereeOptions]);
  const refereeFilterOptions = useMemo(() => {
    const ids = new Set((fixtures || []).map((f) => f.refereeId).filter(Boolean));
    return Array.from(ids).map((id) => ({ id, email: refereeEmailById[id] || "Unknown" })).sort((a, b) => a.email.localeCompare(b.email));
  }, [fixtures, refereeEmailById]);

  const divisionLabelMap = useMemo(() => {
    const map = {};
    (divisionLabels || []).forEach((d) => { map[d.divisionKey] = d.teamLabel; });
    return map;
  }, [divisionLabels]);

  const divisionSquadMap = useMemo(() => {
    const map = {};
    (divisionLabels || []).forEach((d) => { map[d.divisionKey] = d.squadAgeGroup; });
    return map;
  }, [divisionLabels]);

  async function applyImport(parsed, labelMap, squadMap) {
    const rows = parsed
      .filter((f) => f.date) // skip anything with an unparseable date - nothing sensible to store
      .map((f) => ({
        divisionKey: f.division,
        teamLabel: labelMap[f.division] || f.division,
        squadAgeGroup: squadMap[f.division] || "",
        opponent: f.opponent,
        matchDate: f.date.toISOString().slice(0, 10),
        kickoffTime: f.time,
        venue: f.venue,
        homeAway: f.homeAway,
      }));
    const result = await onImportFixtures(rows);
    if (result?.error) {
      setImportMessage(result.error);
    } else {
      setImportMessage(`Imported ${rows.length} fixture${rows.length === 1 ? "" : "s"}.`);
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBusy(true);
    setImportMessage("");
    setPendingUnmapped([]);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseFederationWorkbook(buffer);
      const parsed = extractGarlandaleFixtures(rows);
      if (parsed.length === 0) {
        setImportMessage("No Garlandale fixtures found in that file — double check it's the right spreadsheet.");
        setImportBusy(false);
        return;
      }
      const unmapped = findUnmappedDivisions(parsed, divisionLabelMap);
      if (unmapped.length > 0) {
        setPendingUnmapped(unmapped);
        setPendingFixtures(parsed);
        const guesses = {};
        unmapped.forEach((d) => { guesses[d] = { teamLabel: cleanDivisionGuess(d), squadAgeGroup: "" }; });
        setPendingLabels(guesses);
        setImportMessage(`Found ${parsed.length} fixture${parsed.length === 1 ? "" : "s"}. A few divisions need mapping before continuing.`);
      } else {
        await applyImport(parsed, divisionLabelMap, divisionSquadMap);
      }
    } catch (err) {
      setImportMessage("Could not read that file — make sure it's the federation's .xls/.xlsx fixture sheet.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleConfirmUnmapped() {
    setImportBusy(true);
    try {
      const newLabelMap = { ...divisionLabelMap };
      const newSquadMap = { ...divisionSquadMap };
      for (const division of pendingUnmapped) {
        const entry = pendingLabels[division] || {};
        const teamLabel = (entry.teamLabel || "").trim();
        const squadAgeGroup = (entry.squadAgeGroup || "").trim();
        if (teamLabel) {
          await onSaveDivisionLabel(division, teamLabel, squadAgeGroup);
          newLabelMap[division] = teamLabel;
          newSquadMap[division] = squadAgeGroup;
        }
      }
      await applyImport(pendingFixtures, newLabelMap, newSquadMap);
      setPendingUnmapped([]);
    } finally {
      setImportBusy(false);
    }
  }

  const teamOptions = useMemo(() => {
    const set = new Set((fixtures || []).map((f) => f.squadAgeGroup || f.teamLabel).filter(Boolean));
    return Array.from(set).sort();
  }, [fixtures]);

  const filtered = useMemo(() => {
    let rows = fixtures || [];
    if (dateFilter === "upcoming") {
      const todayStr = todayISO();
      rows = rows.filter((f) => f.matchDate >= todayStr);
    } else if (dateFilter === "month") {
      rows = filterByMonth(rows, (f) => f.matchDate, selectedYear, selectedMonth);
    }
    if (teamFilter !== "All") {
      rows = rows.filter((f) => (f.squadAgeGroup || f.teamLabel) === teamFilter);
    }
    if (refereeFilter !== "All") {
      rows = rows.filter((f) => f.refereeId === refereeFilter);
    }
    return [...rows].sort((a, b) => (a.matchDate + (a.kickoffTime || "")).localeCompare(b.matchDate + (b.kickoffTime || "")));
  }, [fixtures, dateFilter, selectedYear, selectedMonth, teamFilter, refereeFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, {
    pageSize: 15,
    resetKey: `${dateFilter}-${selectedYear}-${selectedMonth}-${teamFilter}-${refereeFilter}`,
  });

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Fixtures</div>
          <div className="gfc-page-sub">Every imported fixture, shared across Fixtures Post and (eventually) the player app</div>
        </div>
      </div>

      {canImport && (
        <div className="gfc-panel" style={{ padding: 16, marginBottom: 18 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 10 }}>Import from federation spreadsheet</div>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 10 }}>
            Upload the federation's fixture spreadsheet (.xls or .xlsx) — every Garlandale match across every division gets pulled out automatically. Re-importing an overlapping date range won't create duplicates; a fixture whose time or venue changed will just be updated.
          </div>
          <input ref={fileInputRef} type="file" accept=".xls,.xlsx" onChange={handleFileSelected} style={{ display: "none" }} />
          <button className="gfc-btn gfc-btn-outline" onClick={() => fileInputRef.current?.click()} disabled={importBusy}>
            {importBusy ? "Working…" : "Choose spreadsheet…"}
          </button>
          {importMessage && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: T.inkSoft, fontWeight: 600 }}>{importMessage}</div>
          )}

          {pendingUnmapped.length > 0 && (
            <div style={{ marginTop: 14, background: T.amberSoft, border: `1px solid ${T.gold}`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7a5410", marginBottom: 10 }}>
                New division{pendingUnmapped.length === 1 ? "" : "s"} found — map {pendingUnmapped.length === 1 ? "it" : "them"} once, remembered for next time.
              </div>
              <datalist id="squad-age-group-options">
                {(ageGroups || []).filter((g) => g !== "All").map((g) => <option key={g} value={g} />)}
              </datalist>
              {pendingUnmapped.map((division) => (
                <div key={division} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.gold}` }}>
                  <label className="gfc-label" style={{ fontWeight: 400, textTransform: "none", fontSize: 11.5 }}>{division}</label>
                  <div className="gfc-row2">
                    <div className="gfc-field" style={{ marginBottom: 0 }}>
                      <label className="gfc-label" style={{ fontSize: 10.5 }}>Poster label</label>
                      <input
                        className="gfc-input"
                        placeholder="e.g. Under 12 'A'"
                        value={pendingLabels[division]?.teamLabel || ""}
                        onChange={(e) => setPendingLabels((prev) => ({ ...prev, [division]: { ...prev[division], teamLabel: e.target.value } }))}
                      />
                    </div>
                    <div className="gfc-field" style={{ marginBottom: 0 }}>
                      <label className="gfc-label" style={{ fontSize: 10.5 }}>Real squad age group</label>
                      <input
                        className="gfc-input"
                        list="squad-age-group-options"
                        placeholder="e.g. U12"
                        value={pendingLabels[division]?.squadAgeGroup || ""}
                        onChange={(e) => setPendingLabels((prev) => ({ ...prev, [division]: { ...prev[division], squadAgeGroup: e.target.value } }))}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={handleConfirmUnmapped} disabled={importBusy}>
                Save &amp; import
              </button>
            </div>
          )}
        </div>
      )}

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Fixture list ({filtered.length})</div>
          <div className="gfc-filters">
            <select className="gfc-select" style={{ maxWidth: 140 }} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
              <option value="upcoming">Upcoming</option>
              <option value="month">By month</option>
              <option value="all">All (incl. past)</option>
            </select>
            {dateFilter === "month" && (
              <>
                <select className="gfc-select" style={{ maxWidth: 150 }} value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                  {MONTH_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}
                </select>
                <select className="gfc-select" style={{ maxWidth: 110 }} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </>
            )}
            <select className="gfc-select" style={{ maxWidth: 160 }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="All">All teams</option>
              {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {refereeFilterOptions.length > 0 && (
              <select className="gfc-select" style={{ maxWidth: 180 }} value={refereeFilter} onChange={(e) => setRefereeFilter(e.target.value)}>
                <option value="All">All referees</option>
                {refereeFilterOptions.map((r) => <option key={r.id} value={r.id}>{r.email}</option>)}
              </select>
            )}
            {canImport && (
              <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={() => setEditingFixture("new")}>+ Add fixture</button>
            )}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No fixtures{dateFilter === "upcoming" ? " upcoming" : ""}</div>
            {canImport ? "Import the federation's spreadsheet above, or add one manually." : "Ask an Admin or Treasurer to import the federation's spreadsheet."}
          </div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Team</th>
                <th>Opponent</th>
                <th>Venue</th>
                <th>H/A</th>
                <th>Referee</th>
                {canImport && <th></th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((f) => (
                <tr key={f.id} className={canImport ? "clickable" : ""} onClick={() => canImport && setEditingFixture(f)}>
                  <td>{fmtDate(f.matchDate)}</td>
                  <td className="gfc-mono">{formatDisplayTime(f.kickoffTime)}</td>
                  <td style={{ fontWeight: 600 }}>{f.squadAgeGroup || f.teamLabel || f.divisionKey}</td>
                  <td>{f.opponent}</td>
                  <td>
                    {f.venue}
                    {(f.locationLink || f.locationEmbed) && (
                      <span title="Location added for the Player Portal" style={{ marginLeft: 4 }}>📍</span>
                    )}
                  </td>
                  <td>{f.homeAway}</td>
                  <td style={{ fontSize: 12 }}>
                    {f.refereeId ? (refereeEmailById[f.refereeId] || "Unknown") : <span style={{ color: T.inkSoft }}>Unassigned</span>}
                  </td>
                  {canImport && (
                    <td><button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); setEditingFixture(f); }}>Edit</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={filtered.length} pageSize={15} />
      </div>

      {editingFixture && (
        <FixtureModal
          fixture={editingFixture === "new" ? null : editingFixture}
          ageGroups={ageGroups}
          refereeOptions={refereeOptions}
          onClose={() => setEditingFixture(null)}
          onSave={onSaveFixture}
          onDelete={onDeleteFixture}
        />
      )}
    </div>
  );
}

function FixtureModal({ fixture, ageGroups, refereeOptions, onClose, onSave, onDelete }) {
  const realAgeGroups = (ageGroups || []).filter((g) => g !== "All");
  const [form, setForm] = useState(() => ({
    id: fixture?.id || "",
    squadAgeGroup: fixture?.squadAgeGroup || realAgeGroups[0] || "",
    opponent: fixture?.opponent || "",
    matchDate: fixture?.matchDate || todayISO(),
    kickoffTime: fixture?.kickoffTime || "",
    venue: fixture?.venue || "",
    homeAway: fixture?.homeAway || "H",
    refereeId: fixture?.refereeId || "",
    locationLink: fixture?.locationLink || "",
    locationEmbed: fixture?.locationEmbed || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.opponent.trim() || !form.matchDate) return;
    const loc = checkLocationFields(form);
    if (!loc.ok) {
      setError(loc.errors.link || loc.errors.embed);
      return;
    }
    setBusy(true);
    setError("");
    const result = await onSave({ ...form, locationLink: loc.locationLink, locationEmbed: loc.locationEmbed });
    if (result?.error) setError(result.error);
    setBusy(false);
  }

  async function handleDelete() {
    setBusy(true);
    setError("");
    const result = await onDelete(fixture.id);
    if (result?.error) setError(result.error);
    setBusy(false);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{fixture ? "Edit fixture" : "Add fixture"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Team / age group</label>
            <select className="gfc-select" value={form.squadAgeGroup} onChange={(e) => update("squadAgeGroup", e.target.value)}>
              {realAgeGroups.length === 0 && <option value="">No age groups yet</option>}
              {realAgeGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Opponent</label>
            <input className="gfc-input" value={form.opponent} onChange={(e) => update("opponent", e.target.value)} required />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Referee</label>
            <select className="gfc-select" value={form.refereeId} onChange={(e) => update("refereeId", e.target.value)}>
              <option value="">— Unassigned —</option>
              {(refereeOptions || []).map((r) => <option key={r.id} value={r.id}>{r.email}</option>)}
            </select>
            {(refereeOptions || []).length === 0 && (
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>No referees invited yet — add one from the Users tab.</div>
            )}
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Date</label>
              <input type="date" className="gfc-input" value={form.matchDate} onChange={(e) => update("matchDate", e.target.value)} required />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Kickoff time</label>
              <input type="time" className="gfc-input" value={form.kickoffTime} onChange={(e) => update("kickoffTime", e.target.value)} />
            </div>
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Venue</label>
              <input className="gfc-input" value={form.venue} onChange={(e) => update("venue", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Home / Away</label>
              <select className="gfc-select" value={form.homeAway} onChange={(e) => update("homeAway", e.target.value)}>
                <option value="H">Home</option>
                <option value="A">Away</option>
              </select>
            </div>
          </div>
          <LocationFields link={form.locationLink} embed={form.locationEmbed} onChange={update} />
          {error && <div style={{ fontSize: 12, color: T.danger, fontWeight: 600, marginBottom: 10 }}>{error}</div>}
          <div className="gfc-modal-actions">
            {fixture && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={handleDelete} disabled={busy}>
                Delete fixture
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
