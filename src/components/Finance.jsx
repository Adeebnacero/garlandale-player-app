import React, { useState, useMemo } from "react";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { T } from "../theme.js";
import { fmtMoney, fmtDate, todayISO } from "../lib/format.js";
import { usePagination, Pagination } from "./shared.jsx";
import {
  buildCombinedLedger,
  computePeriodRange,
  computePeriodLabel,
  computeBalanceCutoff,
  isPastPeriod as isPastPeriodCalc,
  computeStats,
  computeMonthlyChartData,
  computeAvailableYears,
  filterLedger,
  MONTH_NAMES,
} from "../lib/financeCalc.js";

const INCOME_CATEGORIES = ["Donation", "Sponsorship", "Fundraising", "Grant", "Opening Balance", "Other income"];
const EXPENSE_CATEGORIES = ["Equipment", "Referee fees", "Ground hire", "Utilities", "Admin/bank fees", "Other expense"];

export function FinanceView({ financeEntries, players, assets, onAdd, onEdit }) {
  const [categoryFilter, setCategoryFilter] = useState("All");

  const today = useMemo(() => new Date(), []);
  const [viewMode, setViewMode] = useState("month"); // "month" | "year" | "all"
  const [selectedYear, setSelectedYear] = useState(today.getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getUTCMonth()); // 0-11

  const ledger = useMemo(() => buildCombinedLedger(financeEntries, players), [financeEntries, players]);

  const availableYears = useMemo(() => computeAvailableYears(ledger, today), [ledger, today]);

  const periodRange = useMemo(() => computePeriodRange(viewMode, selectedYear, selectedMonth), [viewMode, selectedYear, selectedMonth]);

  const periodLabel = useMemo(() => computePeriodLabel(viewMode, selectedYear, selectedMonth), [viewMode, selectedYear, selectedMonth]);

  const balanceCutoff = useMemo(() => computeBalanceCutoff(periodRange, today), [periodRange, today]);

  const isPastPeriodValue = isPastPeriodCalc(periodRange, today);

  const stats = useMemo(() => computeStats(ledger, periodRange, balanceCutoff, assets), [ledger, periodRange, balanceCutoff, assets]);

  const monthlyChartData = useMemo(() => computeMonthlyChartData(ledger, viewMode, selectedYear, today), [ledger, viewMode, selectedYear, today]);

  const periodFiltered = useMemo(() => filterLedger(ledger, periodRange, categoryFilter), [ledger, periodRange, categoryFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(periodFiltered, {
    pageSize: 15,
    resetKey: `${viewMode}-${selectedYear}-${selectedMonth}-${categoryFilter}`,
  });

  const allCategories = useMemo(() => {
    const set = new Set(ledger.map((r) => r.category));
    return Array.from(set).sort();
  }, [ledger]);

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Finance</div>
          <div className="gfc-page-sub">Cash ledger — bank transactions, donations, and subscription income in one place</div>
        </div>
        <button className="gfc-btn gfc-btn-primary" onClick={onAdd}>+ Add entry</button>
      </div>

      <div className="gfc-panel" style={{ padding: 14, marginBottom: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["month", "year", "all"].map((m) => (
            <button
              key={m}
              className={`gfc-btn gfc-btn-sm ${viewMode === m ? "gfc-btn-primary" : "gfc-btn-outline"}`}
              onClick={() => setViewMode(m)}
            >
              {m === "month" ? "Month" : m === "year" ? "Year" : "All time"}
            </button>
          ))}
        </div>
        {viewMode !== "all" && (
          <select className="gfc-select" style={{ maxWidth: 110 }} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {viewMode === "month" && (
          <select className="gfc-select" style={{ maxWidth: 150 }} value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}
          </select>
        )}
        <div style={{ fontSize: 12, color: T.inkSoft, fontWeight: 600, marginLeft: "auto" }}>
          Viewing: {periodLabel}
        </div>
      </div>

      <div className="gfc-stat-row">
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.indigo }} />
          <div className="gfc-stat-label">Cash balance {isPastPeriodValue ? <span style={{ fontWeight: 400, textTransform: "none" }}>(as of {fmtDate(balanceCutoff)})</span> : <span style={{ fontWeight: 400, textTransform: "none" }}>(today)</span>}</div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.balance)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.green }} />
          <div className="gfc-stat-label">Income <span style={{ fontWeight: 400, textTransform: "none" }}>({periodLabel})</span></div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.totalIncome)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.danger }} />
          <div className="gfc-stat-label">Expenses <span style={{ fontWeight: 400, textTransform: "none" }}>({periodLabel})</span></div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.totalExpense)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.goldDeep }} />
          <div className="gfc-stat-label">Assets value <span style={{ fontWeight: 400, textTransform: "none" }}>(today)</span></div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.assetsValue)}</div>
        </div>
        <div className="gfc-stat">
          <div className="gfc-stat-accent" style={{ background: T.gold }} />
          <div className="gfc-stat-label">Net worth <span style={{ fontWeight: 400, textTransform: "none" }}>(cash + assets)</span></div>
          <div className="gfc-stat-value gfc-mono">{fmtMoney(stats.netWorth)}</div>
        </div>
      </div>

      <div className="gfc-panel" style={{ padding: 16, marginBottom: 18 }}>
        <div className="gfc-panel-title" style={{ marginBottom: 12 }}>Monthly breakdown — {monthlyChartData.year}</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyChartData.data} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={{ stroke: T.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 12.5, borderRadius: 8, border: `1px solid ${T.line}` }} formatter={(v) => fmtMoney(v)} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            <Bar dataKey="income" name="Income" fill={T.green} radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" name="Expenses" fill={T.danger} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Ledger ({periodFiltered.length})</div>
          <div className="gfc-filters">
            <select className="gfc-select" style={{ maxWidth: 180 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All categories</option>
              {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {periodFiltered.length === 0 ? (
          <div className="gfc-empty">
            <div className="gfc-empty-title gfc-display">No entries in this period</div>
            {ledger.length === 0 ? "Add your opening balance to get started, then log bank transactions, donations, and expenses as they happen." : "Try a different month, year, or \"All time\"."}
          </div>
        ) : (
          <div className="gfc-scroll-wrap">
          <table className="gfc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.id} className={r.isSubscription ? "" : "clickable"} onClick={() => !r.isSubscription && onEdit(r)}>
                  <td>{fmtDate(r.date)}</td>
                  <td style={{ fontWeight: 600 }}>{r.description}</td>
                  <td><span className="gfc-agepill" style={{ background: r.isSubscription ? T.green : T.indigoSoft }}>{r.category}</span></td>
                  <td className="gfc-mono" style={{ fontWeight: 700, color: r.type === "expense" ? T.danger : T.green }}>
                    {r.type === "expense" ? "-" : "+"}{fmtMoney(r.amount)}
                  </td>
                  <td>
                    {r.isSubscription ? (
                      <span style={{ fontSize: 11, color: T.inkSoft }} title="Edit this in the player's subscription ledger instead">Via Subscriptions</span>
                    ) : (
                      <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} setPage={setPage} totalPages={totalPages} totalItems={periodFiltered.length} pageSize={15} />
      </div>
    </div>
  );
}

export function FinanceEntryModal({ entry, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({
    id: entry?.id || "",
    date: entry?.date || todayISO(),
    description: entry?.description || "",
    type: entry?.type || "income",
    category: entry?.category || INCOME_CATEGORIES[0],
    amount: entry?.amount ?? "",
  }));

  function update(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Switching type resets category to a sensible default for that type.
      if (field === "type") {
        next.category = value === "expense" ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0];
      }
      return next;
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    onSave(form);
  }

  const categoryOptions = form.type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{entry ? "Edit entry" : "Add entry"}</div>
          <button className="gfc-modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Date</label>
              <input type="date" className="gfc-input" value={form.date} onChange={(e) => update("date", e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Type</label>
              <select className="gfc-select" value={form.type} onChange={(e) => update("type", e.target.value)}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Description</label>
            <input className="gfc-input" placeholder="e.g. Donation from Smith family, Referee fees - 18 July" value={form.description} onChange={(e) => update("description", e.target.value)} required />
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Category</label>
              <select className="gfc-select" value={form.category} onChange={(e) => update("category", e.target.value)}>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Amount (R)</label>
              <input type="number" min="0" step="any" className="gfc-input" value={form.amount} onChange={(e) => update("amount", e.target.value)} required />
            </div>
          </div>
          {form.category === "Opening Balance" && (
            <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 14 }}>
              Use this once to set the club's starting cash balance before you began logging transactions here.
            </div>
          )}
          <div className="gfc-modal-actions">
            {entry && (
              <button type="button" className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={() => onDelete(entry.id)}>
                Delete entry
              </button>
            )}
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary">Save entry</button>
          </div>
        </form>
      </div>
    </div>
  );
}
