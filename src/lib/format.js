// ---------------------------------------------------------------------------
// Small formatting helpers used throughout the app. Pure, no dependencies.
// ---------------------------------------------------------------------------

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function fmtMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-" : "") + "R" + Math.abs(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export function digitsOnly(phone) {
  return (phone || "").replace(/[^\d]/g, "");
}
