// ---------------------------------------------------------------------------
// Design tokens (colors) and global CSS for the whole app. Extracted to its
// own module since nearly every component depends on `T` (the color
// palette) - keeping it separate makes that dependency explicit rather
// than implicit via a shared giant file.
// ---------------------------------------------------------------------------

/* ---------- DESIGN TOKENS ----------
  Palette drawn from the Garlandale FC crest:
  ink-indigo  #241a45  (crest left panel, deepened for text/surfaces)
  pitch-green #1e7a41  (crest right panel)
  gold        #e8ac2e  (crest border / eagle)
  gold-deep   #c98a12  (hover/active states)
  paper       #f6f2e9  (warm neutral background, not pure white)
  ink         #1c1730  (body text)
  danger      #c1443c
  amber       #d68f1e (reuses gold family for "partial" status)
------------------------------------- */

export const T = {
  indigo: "#241a45",
  indigoSoft: "#342763",
  green: "#1e7a41",
  greenSoft: "#e6f3ea",
  gold: "#e8ac2e",
  goldDeep: "#c98a12",
  paper: "#f6f2e9",
  paperDim: "#efe9da",
  ink: "#1c1730",
  inkSoft: "#5b5470",
  danger: "#c1443c",
  dangerSoft: "#fbe9e7",
  amber: "#d68f1e",
  amberSoft: "#fbf1de",
  line: "#e2dbc9",
};

export const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Anton&family=Karla:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap');`;

// Maps a compliance status string (from billing.js's complianceStatus()) to
// a display color. Kept here rather than in billing.js since billing.js is
// deliberately free of any styling/theme dependency.
export const STATUS_COLOR = { green: T.green, amber: T.amber, red: T.danger, inactive: T.inkSoft };


export const GLOBAL_CSS = `
${FONT_IMPORT}

* { box-sizing: border-box; }

.gfc-app {
  font-family: 'Karla', sans-serif;
  background: ${T.paper};
  color: ${T.ink};
  min-height: 100vh;
  display: flex;
  width: 100%;
}

.gfc-display {
  font-family: 'Anton', sans-serif;
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.gfc-mono {
  font-family: 'JetBrains Mono', monospace;
}

/* -------- Sidebar -------- */
.gfc-sidebar {
  width: 220px;
  min-width: 220px;
  background: ${T.indigo};
  color: #fff;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
}
.gfc-sidebar::after {
  content: "";
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 60%;
  background: linear-gradient(135deg, transparent 48%, ${T.green} 48.5%);
  opacity: 0.35;
  pointer-events: none;
}
.gfc-crest-wrap {
  padding: 28px 20px 18px;
  text-align: center;
  position: relative;
  z-index: 1;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.gfc-crest-wrap img {
  width: 72px;
  height: 72px;
  display: block;
  margin: 0 auto 10px;
  filter: drop-shadow(0 4px 10px rgba(0,0,0,0.35));
}
.gfc-club-name {
  color: ${T.gold};
  font-size: 18px;
  line-height: 1.15;
}
.gfc-club-sub {
  color: rgba(255,255,255,0.55);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-top: 4px;
}
.gfc-nav {
  flex: 1;
  padding: 16px 12px;
  position: relative;
  z-index: 1;
  overflow-y: auto;
}
.gfc-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.72);
  font-family: 'Karla', sans-serif;
  font-weight: 600;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s ease, color 0.15s ease;
}
.gfc-nav-item:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}
.gfc-nav-item.active {
  background: ${T.gold};
  color: ${T.indigo};
}
.gfc-nav-icon { font-size: 15px; width: 18px; text-align: center; }

.gfc-sidebar-foot {
  padding: 14px 20px 20px;
  position: relative;
  z-index: 1;
  font-size: 10.5px;
  color: rgba(255,255,255,0.4);
  border-top: 1px solid rgba(255,255,255,0.1);
}

/* -------- Main -------- */
.gfc-main {
  flex: 1;
  min-width: 0;
  padding: 28px 34px 60px;
}
.gfc-topbar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 22px;
  flex-wrap: wrap;
  gap: 10px;
}
.gfc-page-title {
  font-size: 26px;
  color: ${T.indigo};
}
.gfc-page-sub {
  color: ${T.inkSoft};
  font-size: 13px;
  margin-top: 2px;
}

.gfc-btn {
  font-family: 'Karla', sans-serif;
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.02em;
  border-radius: 7px;
  padding: 9px 16px;
  border: none;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.15s ease, background 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.gfc-btn:active { transform: translateY(1px); }
.gfc-btn-primary { background: ${T.gold}; color: ${T.indigo}; }
.gfc-btn-primary:hover { background: ${T.goldDeep}; }
.gfc-btn-outline { background: transparent; color: ${T.indigo}; border: 1.5px solid ${T.indigo}; }
.gfc-btn-outline:hover { background: ${T.indigo}; color: #fff; }
.gfc-btn-ghost { background: transparent; color: ${T.inkSoft}; padding: 8px 10px; }
.gfc-btn-ghost:hover { color: ${T.ink}; }
.gfc-btn-danger { background: ${T.danger}; color: #fff; }
.gfc-btn-sm { padding: 6px 11px; font-size: 11.5px; }
.gfc-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* -------- Cards / stats -------- */
.gfc-stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 26px;
}
.gfc-stat {
  background: #fff;
  border: 1px solid ${T.line};
  border-radius: 10px;
  padding: 16px 18px;
  position: relative;
  overflow: hidden;
}
.gfc-stat-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${T.inkSoft};
  font-weight: 700;
}
.gfc-stat-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 26px;
  font-weight: 600;
  margin-top: 6px;
  color: ${T.indigo};
}
.gfc-stat-accent {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
}

/* -------- Table -------- */
.gfc-panel {
  background: #fff;
  border: 1px solid ${T.line};
  border-radius: 12px;
  overflow: hidden;
}
.gfc-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid ${T.line};
  flex-wrap: wrap;
  gap: 10px;
}
.gfc-panel-title {
  font-size: 14px;
  font-weight: 700;
  color: ${T.indigo};
}
table.gfc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.gfc-table th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${T.inkSoft};
  padding: 10px 14px;
  background: ${T.paperDim};
  border-bottom: 1px solid ${T.line};
  white-space: nowrap;
}
table.gfc-table td {
  padding: 11px 14px;
  border-bottom: 1px solid ${T.line};
  vertical-align: middle;
}
table.gfc-table tr:last-child td { border-bottom: none; }
table.gfc-table tr.clickable { cursor: pointer; }
table.gfc-table tr.clickable:hover td { background: ${T.paperDim}; }

/* -------- Pagination -------- */
.gfc-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid ${T.line};
}
.gfc-pagination-range {
  font-size: 12px;
  color: ${T.inkSoft};
  font-weight: 600;
}
.gfc-pagination-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.gfc-pagination-label {
  font-size: 12px;
  color: ${T.inkSoft};
  font-weight: 600;
  padding: 0 4px;
  white-space: nowrap;
}

.gfc-empty {
  padding: 40px 20px;
  text-align: center;
  color: ${T.inkSoft};
  font-size: 13px;
}
.gfc-empty-title {
  font-family: 'Anton', sans-serif;
  text-transform: uppercase;
  color: ${T.indigo};
  font-size: 17px;
  margin-bottom: 6px;
}

/* -------- Badges -------- */
.gfc-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.gfc-dot { width: 7px; height: 7px; border-radius: 50%; }
.gfc-badge-green { background: ${T.greenSoft}; color: ${T.green}; }
.gfc-badge-green .gfc-dot { background: ${T.green}; }
.gfc-badge-amber { background: ${T.amberSoft}; color: ${T.amberSoft === T.amberSoft ? "#8a5c0f" : ""}; }
.gfc-badge-amber .gfc-dot { background: ${T.amber}; }
.gfc-badge-red { background: ${T.dangerSoft}; color: ${T.danger}; }
.gfc-badge-red .gfc-dot { background: ${T.danger}; }
.gfc-badge-neutral { background: ${T.paperDim}; color: ${T.inkSoft}; }
.gfc-badge-neutral .gfc-dot { background: ${T.inkSoft}; }

.gfc-agepill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  background: ${T.indigoSoft};
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}

/* -------- Forms -------- */
.gfc-field { margin-bottom: 14px; }
.gfc-label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: ${T.inkSoft};
  margin-bottom: 5px;
}
.gfc-input, .gfc-select, .gfc-textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1.5px solid ${T.line};
  border-radius: 7px;
  font-family: 'Karla', sans-serif;
  font-size: 13.5px;
  background: #fff;
  color: ${T.ink};
}
.gfc-input:focus, .gfc-select:focus, .gfc-textarea:focus {
  outline: none;
  border-color: ${T.gold};
  box-shadow: 0 0 0 3px rgba(232,172,46,0.25);
}
.gfc-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.gfc-check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }

/* -------- Modal -------- */
.gfc-modal-backdrop {
  position: fixed; inset: 0; background: rgba(28,23,48,0.55);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 40px 16px; overflow-y: auto; z-index: 50;
}
.gfc-modal {
  background: #fff; border-radius: 14px; width: 100%; max-width: 520px;
  padding: 26px 26px 22px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.gfc-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
}
.gfc-modal-title { font-size: 18px; color: ${T.indigo}; }
.gfc-modal-close {
  background: none; border: none; font-size: 20px; color: ${T.inkSoft};
  cursor: pointer; line-height: 1;
}
.gfc-modal-actions {
  display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;
  padding-top: 16px; border-top: 1px solid ${T.line};
}

/* -------- Player card (squad view signature element) -------- */
.gfc-squad-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}
.gfc-card {
  position: relative;
  background: #fff;
  border: 1px solid ${T.line};
  border-radius: 12px;
  padding: 16px 16px 14px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
  overflow: hidden;
}
.gfc-card:hover { box-shadow: 0 8px 22px rgba(36,26,69,0.14); transform: translateY(-2px); }
.gfc-card-ribbon {
  position: absolute;
  top: 0; right: 0;
  width: 0; height: 0;
  border-style: solid;
  border-width: 0 46px 46px 0;
}
.gfc-card-name { font-weight: 700; font-size: 14.5px; color: ${T.ink}; padding-right: 30px; }
.gfc-card-meta { font-size: 12px; color: ${T.inkSoft}; margin-top: 3px; }
.gfc-card-foot {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 12px; padding-top: 10px; border-top: 1px dashed ${T.line};
}
.gfc-card-balance { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 13px; }

.gfc-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.gfc-msg-preview {
  background: ${T.paperDim};
  border: 1px solid ${T.line};
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
  white-space: pre-wrap;
  color: ${T.ink};
}

.gfc-checklist {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid ${T.line};
  border-radius: 8px;
}
.gfc-checklist-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid ${T.line}; font-size: 12.5px;
}
.gfc-checklist-row:last-child { border-bottom: none; }
.gfc-checklist-left { display: flex; align-items: center; gap: 8px; }

.gfc-send-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-bottom: 1px solid ${T.line}; font-size: 12.5px;
  gap: 10px;
}
.gfc-send-row:last-child { border-bottom: none; }
.gfc-send-actions { display: flex; gap: 6px; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 8px; }

@media (max-width: 720px) {
  .gfc-app { flex-direction: column; }
  .gfc-sidebar { width: 100%; min-width: 0; position: relative; top: auto; height: auto; }
  .gfc-nav { display: flex; overflow-x: auto; overflow-y: visible; padding: 10px 12px; }
  .gfc-nav-item { white-space: nowrap; margin-bottom: 0; }
  .gfc-main { padding: 20px 16px 40px; }
  .gfc-row2 { grid-template-columns: 1fr; }
}
`;
