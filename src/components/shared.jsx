import React, { useState, useEffect } from "react";
import { T } from "../theme.js";
import { STATUS_LABEL } from "../lib/billing.js";
import { parseMapsLink, parseMapsEmbed } from "../lib/mapLinks.js";

export function Badge({ status, reason }) {
  const cls = status === "green" ? "gfc-badge-green" : status === "amber" ? "gfc-badge-amber" : status === "red" ? "gfc-badge-red" : "gfc-badge-neutral";
  return (
    <span className={`gfc-badge ${cls}`} title={reason || undefined} style={reason ? { cursor: "help" } : undefined}>
      <span className="gfc-dot" />
      {STATUS_LABEL[status] || "—"}
    </span>
  );
}

export function InactiveToggle({ includeInactive, setIncludeInactive }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: T.inkSoft, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
      Show inactive players
    </label>
  );
}

/**
 * Client-side pagination for an already-filtered array. `resetKey` should be
 * anything that changes when the caller's filters change (e.g. a template
 * string of the active filter values) so the page snaps back to 1 instead of
 * landing on an empty page after the filtered set shrinks.
 *
 * @param {Array<any>} items
 * @param {{ pageSize?: number, resetKey?: any }} [options]
 */
export function usePagination(items, options) {
  const { pageSize = 15, resetKey } = options || {};
  const [page, setPage] = useState(1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return { page, setPage, totalPages, pageItems, pageSize };
}

export function Pagination({ page, setPage, totalPages, totalItems, pageSize }) {
  if (totalPages <= 1) return null;
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);
  return (
    <div className="gfc-pagination">
      <span className="gfc-pagination-range">
        {totalItems ? `${start}–${end} of ${totalItems}` : ""}
      </span>
      <div className="gfc-pagination-controls">
        <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
        <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
        <span className="gfc-pagination-label">Page {page} of {totalPages}</span>
        <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        <button className="gfc-btn gfc-btn-outline gfc-btn-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
      </div>
    </div>
  );
}

/* ---------- LOCATION FIELDS (fixtures, Matchday, notices) ---------- */

// Optional exact venue location, shown to guardians in the Player Portal
// as a Directions button (link) and/or a Show map button (embed). Each
// box is checked when the user leaves it: a valid entry is tidied up (for
// embed code, only the map address is kept), an invalid one shows why.
// Forms must still call checkLocationFields() from lib/mapLinks.js on
// submit, since someone can press Save without leaving the box first.
export function LocationFields({ link, embed, onChange }) {
  const [errors, setErrors] = useState({ link: "", embed: "" });

  function checkField(field, raw, parse) {
    const result = parse(raw);
    if (result.error) {
      setErrors((e) => ({ ...e, [field]: result.error }));
    } else {
      setErrors((e) => ({ ...e, [field]: "" }));
      if (result.value !== raw) onChange(field === "link" ? "locationLink" : "locationEmbed", result.value);
    }
  }

  const hint = { fontSize: 11, color: T.inkSoft, marginTop: 4 };
  const err = { fontSize: 11.5, color: T.danger, fontWeight: 600, marginTop: 4 };
  const ok = { fontSize: 11, color: T.green, fontWeight: 600, marginTop: 4 };

  return (
    <div style={{ background: T.paperDim, border: `1px solid ${T.line}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.indigo }}>Location (optional)</div>
      <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 10 }}>
        Adds a Directions button and/or a map for guardians in the Player Portal. Google Maps only.
      </div>

      <div className="gfc-field">
        <label className="gfc-label">Directions link</label>
        <input
          className="gfc-input"
          placeholder="https://maps.app.goo.gl/..."
          value={link}
          onChange={(e) => { onChange("locationLink", e.target.value); if (errors.link) setErrors((x) => ({ ...x, link: "" })); }}
          onBlur={(e) => checkField("link", e.target.value, parseMapsLink)}
        />
        {errors.link
          ? <div style={err}>{errors.link}</div>
          : <div style={hint}>In Google Maps, find the exact spot, tap Share, then Copy link.</div>}
      </div>

      <div className="gfc-field" style={{ marginBottom: 0 }}>
        <label className="gfc-label">Map embed</label>
        <textarea
          className="gfc-textarea"
          rows={2}
          placeholder='<iframe src="https://www.google.com/maps/embed?pb=..." ...></iframe>'
          value={embed}
          onChange={(e) => { onChange("locationEmbed", e.target.value); if (errors.embed) setErrors((x) => ({ ...x, embed: "" })); }}
          onBlur={(e) => checkField("embed", e.target.value, parseMapsEmbed)}
          style={{ fontFamily: "monospace", fontSize: 11.5 }}
        />
        {errors.embed
          ? <div style={err}>{errors.embed}</div>
          : embed && embed.startsWith("https://")
            ? <div style={ok}>✓ Map address saved from the embed code.</div>
            : <div style={hint}>In Google Maps, tap Share, then Embed a map, then Copy HTML. Paste the whole code.</div>}
      </div>
    </div>
  );
}

/* ---------- AGE GROUP PICKER (notices and Home banners) ---------- */

// Tick one or more age groups, or "Everyone" (an empty list). Choosing
// Everyone clears the individual ticks and vice versa, so it's always
// clear which applies. For coaches, `allowEveryone` is false and `options`
// holds only their own teams.
export function AgeGroupPicker({ value, onChange, options, allowEveryone, label = "Who sees it", id = "agp" }) {
  const selected = new Set(value || []);
  const everyone = allowEveryone && selected.size === 0;
  const toggle = (g) => {
    const next = new Set(selected);
    if (next.has(g)) next.delete(g); else next.add(g);
    onChange(options.filter((o) => next.has(o)));
  };
  const chip = (on) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
    border: `1.5px solid ${on ? T.indigo : T.line}`, background: on ? T.indigo : "#fff", color: on ? "#fff" : T.ink,
    fontSize: 12.5, fontWeight: 700,
  });
  return (
    <div className="gfc-field">
      <style>{`.agp-chip { position: relative; user-select: none; } .agp-chip:focus-within { outline: 3px solid ${T.gold}; outline-offset: 2px; }`}</style>
      <div className="gfc-label" id={`${id}-label`}>{label}</div>
      <div role="group" aria-labelledby={`${id}-label`} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {allowEveryone && (
          <label className="agp-chip" style={chip(everyone)}>
            <input type="checkbox" checked={everyone} onChange={() => onChange([])} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
            Everyone
          </label>
        )}
        {options.map((g) => (
          <label key={g} className="agp-chip" style={chip(selected.has(g))}>
            <input type="checkbox" checked={selected.has(g)} onChange={() => toggle(g)} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
            {g}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 5 }}>
        {everyone ? "Everyone: all players and guardians." : selected.size ? `Only ${[...options.filter((o) => selected.has(o))].join(", ")}.` : "Tick at least one age group."}
      </div>
    </div>
  );
}
