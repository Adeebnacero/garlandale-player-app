import React, { useMemo } from "react";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { T } from "../theme.js";
import { sortAgeGroups } from "../lib/billing.js";
import { fmtMoney, fmtDate, todayISO } from "../lib/format.js";
import { Badge, InactiveToggle } from "./shared.jsx";

export function DashboardView({ stats, enriched, includeInactive, setIncludeInactive, onGoSquad }) {
  const worstOwed = [...enriched].filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);

  const ageGroupData = useMemo(() => {
    const counts = {};
    enriched.forEach((p) => { counts[p.ageGroup] = (counts[p.ageGroup] || 0) + 1; });
    return sortAgeGroups(Object.keys(counts)).map((g) => ({ ageGroup: g, players: counts[g] }));
  }, [enriched]);

  const yearGrowthData = useMemo(() => {
    const withJoinYear = enriched
      .map((p) => ({ ...p, joinYear: p.joinDate ? new Date(p.joinDate).getFullYear() : null }))
      .filter((p) => p.joinYear && !isNaN(p.joinYear));
    if (withJoinYear.length === 0) return [];
    const minYear = Math.min(...withJoinYear.map((p) => p.joinYear));
    const maxYear = Math.max(...withJoinYear.map((p) => p.joinYear), new Date().getFullYear());
    const newByYear = {};
    withJoinYear.forEach((p) => { newByYear[p.joinYear] = (newByYear[p.joinYear] || 0) + 1; });

    const rows = [];
    let cumulative = 0;
    for (let y = minYear; y <= maxYear; y++) {
      cumulative += newByYear[y] || 0;
      rows.push({ year: String(y), newPlayers: newByYear[y] || 0, cumulative });
    }
    return rows;
  }, [enriched]);

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Dashboard</div>
          <div className="gfc-page-sub">Club snapshot, {fmtDate(todayISO())}</div>
        </div>
        <InactiveToggle includeInactive={includeInactive} setIncludeInactive={setIncludeInactive} />
      </div>

      <div className="gfc-stat-row">
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.indigo }} />
          <div className="gfc-stat-label">Registered players</div>
          <div className="gfc-stat-value gfc-mono">{stats.total}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.danger }} />
          <div className="gfc-stat-label">Total owed</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.totalOwed)}</div>
        </div>
        <div className="gfc-stat" style={{ cursor: "pointer" }} onClick={() => onGoSquad("green")}>
          <div className="gfc-stat-accent" style={{ background: T.green }} />
          <div className="gfc-stat-label">Compliant</div>
          <div className="gfc-stat-value gfc-mono">{stats.compliant}</div>
        </div>
        <div className="gfc-stat" style={{ cursor: "pointer" }} onClick={() => onGoSquad("amber")}>
          <div className="gfc-stat-accent" style={{ background: T.amber }} />
          <div className="gfc-stat-label">Payment due</div>
          <div className="gfc-stat-value gfc-mono">{stats.dueSoon}</div>
        </div>
        <div className="gfc-stat" style={{ cursor: "pointer" }} onClick={() => onGoSquad("red")}>
          <div className="gfc-stat-accent" style={{ background: T.danger }} />
          <div className="gfc-stat-label">Non-compliant</div>
          <div className="gfc-stat-value gfc-mono">{stats.nonCompliant}</div>
        </div>
      </div>

      <div className="gfc-row2" style={{ marginBottom: 20 }}>
        <div className="gfc-panel" style={{ padding: 16 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Players per age group</div>
          {ageGroupData.length === 0 ? (
            <div className="gfc-empty">No players to show yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ageGroupData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                <XAxis dataKey="ageGroup" tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={{ stroke: T.line }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12.5, borderRadius: 8, border: `1px solid ${T.line}` }} />
                <Bar dataKey="players" radius={[4, 4, 0, 0]}>
                  {ageGroupData.map((_, i) => <Cell key={i} fill={T.indigo} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="gfc-panel" style={{ padding: 16 }}>
          <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Year-on-year growth</div>
          {yearGrowthData.length === 0 ? (
            <div className="gfc-empty">Add join dates to players to see growth over time.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={yearGrowthData} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={{ stroke: T.line }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12.5, borderRadius: 8, border: `1px solid ${T.line}` }} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} />
                <Bar dataKey="newPlayers" name="New registrations" fill={T.gold} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative registrations" stroke={T.green} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Biggest outstanding balances</div>
        </div>
        {worstOwed.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">All settled up</div>
            No players currently owe a subscription balance.
          </div>
        ) : (
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Age group</th>
                <th>Owed</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {worstOwed.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><span className="gfc-agepill">{p.ageGroup}</span></td>
                  <td className="gfc-mono" style={{ color: T.danger, fontWeight: 700 }}>{fmtMoney(p.balance)}</td>
                  <td><Badge status={p.status} reason={p.reason} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
