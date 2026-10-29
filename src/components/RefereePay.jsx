import React, { useMemo, useState } from "react";
import { T } from "../theme.js";
import { fmtDate, fmtMoney } from "../lib/format.js";
import { MONTH_NAMES, computeAvailableYears, filterByMonth } from "../lib/dateCascade.js";
import { usePagination, Pagination } from "./shared.jsx";

// Joins referee_appointments with the fixture and referee they belong to -
// appointments only store ids, everything display-worthy (opponent, date,
// team, email) is looked up from the fixtures/staff lists already loaded
// elsewhere in the app, same approach as staffTeams/coach assignments.
function useJoinedAppointments(appointments, fixtures, staffList) {
  return useMemo(() => {
    const fixtureById = {};
    (fixtures || []).forEach((f) => { fixtureById[f.id] = f; });
    const refereeById = {};
    (staffList || []).forEach((s) => { refereeById[s.id] = s; });
    return (appointments || [])
      .map((a) => {
        const fixture = fixtureById[a.fixtureId];
        const referee = refereeById[a.refereeId];
        return {
          ...a,
          matchDate: fixture?.matchDate || "",
          team: fixture ? (fixture.squadAgeGroup || fixture.teamLabel || fixture.divisionKey) : "",
          opponent: fixture?.opponent || "(fixture deleted)",
          refereeEmail: referee?.email || "Unknown",
        };
      })
      .sort((a, b) => (b.matchDate || "").localeCompare(a.matchDate || ""));
  }, [appointments, fixtures, staffList]);
}

export function RefereePayView({ fixtures, staffList, appointments, onUpdateAppointment }) {
  const joined = useJoinedAppointments(appointments, fixtures, staffList);

  const today = useMemo(() => new Date(), []);
  const [dateFilter, setDateFilter] = useState("month"); // "month" | "all"
  const [selectedYear, setSelectedYear] = useState(today.getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getUTCMonth());
  const [refereeFilter, setRefereeFilter] = useState("All");

  const availableYears = useMemo(() => computeAvailableYears(joined, (a) => a.matchDate, today), [joined, today]);

  const refereeOptions = useMemo(() => {
    const map = new Map();
    joined.forEach((a) => { if (a.refereeId) map.set(a.refereeId, a.refereeEmail); });
    return Array.from(map.entries()).map(([id, email]) => ({ id, email })).sort((a, b) => a.email.localeCompare(b.email));
  }, [joined]);

  const filtered = useMemo(() => {
    let rows = joined;
    if (dateFilter === "month") {
      rows = filterByMonth(rows, (a) => a.matchDate, selectedYear, selectedMonth);
    }
    if (refereeFilter !== "All") {
      rows = rows.filter((a) => a.refereeId === refereeFilter);
    }
    return rows;
  }, [joined, dateFilter, selectedYear, selectedMonth, refereeFilter]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, a) => {
        acc.total += a.feeAmount;
        if (a.paid) acc.paid += a.feeAmount; else acc.unpaid += a.feeAmount;
        return acc;
      },
      { total: 0, paid: 0, unpaid: 0 }
    );
  }, [filtered]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, {
    pageSize: 20,
    resetKey: `${dateFilter}-${selectedYear}-${selectedMonth}-${refereeFilter}`,
  });

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Referee Pay</div>
          <div className="gfc-page-sub">Every referee appointment, with the fee owed and whether it's been paid — this is the monthly payment record</div>
        </div>
      </div>

      <div className="gfc-panel" style={{ padding: 16, marginBottom: 18, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Total for period</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtMoney(totals.total)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Paid</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.green }}>{fmtMoney(totals.paid)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Still owed</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: totals.unpaid > 0 ? T.danger : T.green }}>{fmtMoney(totals.unpaid)}</div>
        </div>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Appointments ({filtered.length})</div>
          <div className="gfc-filters">
            <select className="gfc-select" style={{ maxWidth: 130 }} value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
              <option value="month">By month</option>
              <option value="all">All</option>
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
            {refereeOptions.length > 0 && (
              <select className="gfc-select" style={{ maxWidth: 180 }} value={refereeFilter} onChange={(e) => setRefereeFilter(e.target.value)}>
                <option value="All">All referees</option>
                {refereeOptions.map((r) => <option key={r.id} value={r.id}>{r.email}</option>)}
              </select>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No appointments{dateFilter === "month" ? " this month" : ""}</div>
            Assign a referee to a fixture on the Fixtures tab and it'll show up here automatically.
          </div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Opponent</th>
                <th>Referee</th>
                <th>Fee</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((a) => (
                <AppointmentRow key={a.id} appointment={a} onUpdateAppointment={onUpdateAppointment} />
              ))}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={filtered.length} pageSize={20} />
      </div>
    </div>
  );
}

function AppointmentRow({ appointment: a, onUpdateAppointment, key }) {
  const [fee, setFee] = useState(a.feeAmount);
  const [busy, setBusy] = useState(false);

  async function commitFee() {
    if (Number(fee) === a.feeAmount) return;
    setBusy(true);
    await onUpdateAppointment(a.id, { feeAmount: fee });
    setBusy(false);
  }

  async function togglePaid() {
    setBusy(true);
    await onUpdateAppointment(a.id, { paid: !a.paid });
    setBusy(false);
  }

  return (
    <tr>
      <td>{fmtDate(a.matchDate)}</td>
      <td style={{ fontWeight: 600 }}>{a.team}</td>
      <td>{a.opponent}</td>
      <td>{a.refereeEmail}</td>
      <td>
        <input
          type="number"
          step="0.01"
          min="0"
          className="gfc-input"
          style={{ maxWidth: 100, padding: "4px 8px" }}
          value={fee}
          disabled={busy}
          onChange={(e) => setFee(e.target.value)}
          onBlur={commitFee}
        />
      </td>
      <td>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={a.paid} disabled={busy} onChange={togglePaid} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: a.paid ? T.green : T.inkSoft }}>{a.paid ? "Paid" : "Unpaid"}</span>
        </label>
      </td>
    </tr>
  );
}
