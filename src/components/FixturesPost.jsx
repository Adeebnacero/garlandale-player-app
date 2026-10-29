import React, { useState, useEffect, useMemo } from "react";
import html2canvas from "html2canvas";
import { T } from "../theme.js";
import { todayISO } from "../lib/format.js";
import BADGE_SRC from "../assets/badge.png";
import { fmtImportDateHeader, formatDisplayTime, groupFixturesByDate } from "../lib/fixtureImport.js";
import { downloadFixturesPdf } from "../lib/fixturePdf.js";

export function formatFixtureHeader(headerRaw) {
  let datePart = headerRaw;
  let suffix = "";
  const dashSplit = headerRaw.split(/\s+-\s+/);
  if (dashSplit.length === 2) {
    datePart = dashSplit[0].trim();
    suffix = dashSplit[1].trim();
  }
  const parsed = new Date(datePart);
  let label;
  if (!isNaN(parsed.getTime())) {
    label = parsed
      .toLocaleDateString("en-ZA", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
      .toUpperCase();
  } else {
    label = headerRaw.toUpperCase();
  }
  return suffix ? `${label} – ${suffix.toUpperCase()}` : label;
}

/** Builds the {headerRaw, rows} shape the poster/PDF already understand, from a plain list of selected fixture rows (see src/lib/dbMappers.js:fromDbFixture). */
export function buildGroupsFromFixtures(selectedFixtures) {
  const asDates = selectedFixtures.map((f) => ({ ...f, date: new Date(f.matchDate + "T00:00:00Z") }));
  const dateGroups = groupFixturesByDate(asDates);
  return dateGroups.map((g) => ({
    headerRaw: fmtImportDateHeader(g.date) || "Unknown date",
    rows: g.rows.map((f) => ({
      team: f.squadAgeGroup || f.teamLabel || f.divisionKey,
      vs: f.opponent,
      time: formatDisplayTime(f.kickoffTime),
      venue: f.venue,
    })),
  }));
}

export function FixturesPostView({ fixtures }) {
  const [dateRangeLabel, setDateRangeLabel] = useState("29 APRIL – 02 MAY 2026");
  const [handle, setHandle] = useState("@GARLANDALEFC");
  const [hashtag, setHashtag] = useState("#WEAREGARLANDALE");
  const [downloading, setDownloading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const posterRef = React.useRef(null);

  const [footerNotice1, setFooterNotice1] = useState("PLEASE BRING YOUR SHINGUARDS!");
  const [footerNotice2, setFooterNotice2] = useState("PLEASE REPORT 1 HOUR BEFORE YOUR GAME!");
  const [contactName, setContactName] = useState("Yusuf Nacerodien");
  const [contactPhone, setContactPhone] = useState("083-556-4102");

  const [tuckshopText, setTuckshopText] = useState("");
  const tuckshopItems = useMemo(
    () => tuckshopText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    [tuckshopText]
  );

  // Only upcoming fixtures are worth putting on a poster - the Fixtures tab
  // is where the full history/all-time list lives.
  const upcoming = useMemo(() => {
    const today = todayISO();
    return (fixtures || [])
      .filter((f) => f.matchDate >= today)
      .sort((a, b) => (a.matchDate + (a.kickoffTime || "")).localeCompare(b.matchDate + (b.kickoffTime || "")));
  }, [fixtures]);

  // Checked by default - the Treasurer deselects anything that shouldn't
  // appear on this particular week's poster, rather than opting each one in.
  const [selectedIds, setSelectedIds] = useState(() => new Set(upcoming.map((f) => f.id)));
  useEffect(() => {
    setSelectedIds(new Set(upcoming.map((f) => f.id)));
  }, [fixtures]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleFixture(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelectedIds(new Set(upcoming.map((f) => f.id))); }
  function selectNone() { setSelectedIds(new Set()); }

  const selectedFixtures = useMemo(() => upcoming.filter((f) => selectedIds.has(f.id)), [upcoming, selectedIds]);
  const groups = useMemo(() => buildGroupsFromFixtures(selectedFixtures), [selectedFixtures]);
  const upcomingByDate = useMemo(() => groupFixturesByDate(upcoming.map((f) => ({ ...f, date: new Date(f.matchDate + "T00:00:00Z") }))), [upcoming]);

  function handleDownloadPdf() {
    if (groups.length === 0) return;
    setDownloadingPdf(true);
    try {
      downloadFixturesPdf(
        groups,
        { footerNotices: [footerNotice1, footerNotice2].filter(Boolean), contactName, contactPhone },
        `garlandale-fixtures-${todayISO()}.pdf`
      );
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleDownload() {
    if (!posterRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(posterRef.current, { scale: 2, backgroundColor: null, useCORS: true });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `garlandale-fixtures-${todayISO()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Fixtures Post</div>
          <div className="gfc-page-sub">Select this week's fixtures, preview the poster, download for Instagram</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {groups.length > 0 && (
            <button className="gfc-btn gfc-btn-outline" onClick={handleDownloadPdf} disabled={downloadingPdf}>
              {downloadingPdf ? "Preparing…" : "Download PDF"}
            </button>
          )}
          <button className="gfc-btn gfc-btn-primary" onClick={handleDownload} disabled={downloading}>
            {downloading ? "Preparing…" : "Download image"}
          </button>
        </div>
      </div>

      <div className="gfc-row2" style={{ gridTemplateColumns: "380px 1fr", alignItems: "flex-start" }}>
        <div className="gfc-panel" style={{ padding: 16 }}>
          <div className="gfc-panel-head" style={{ marginBottom: 8 }}>
            <div className="gfc-panel-title">Select fixtures ({selectedFixtures.length}/{upcoming.length})</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={selectAll}>All</button>
              <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={selectNone}>None</button>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <div className="gfc-empty">
              No upcoming fixtures. Import the federation's spreadsheet in the <strong>Fixtures</strong> tab first.
            </div>
          ) : (
            <div className="gfc-checklist" style={{ marginBottom: 14 }}>
              {upcomingByDate.map((group) => (
                <div key={group.date.toISOString()}>
                  <div style={{ background: T.paperDim, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase" }}>
                    {fmtImportDateHeader(group.date)}
                  </div>
                  {group.rows.map((f) => (
                    <label key={f.id} className="gfc-checklist-row" style={{ cursor: "pointer" }}>
                      <span className="gfc-checklist-left">
                        <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggleFixture(f.id)} />
                        <span>
                          <strong>{f.squadAgeGroup || f.teamLabel || f.divisionKey}</strong> vs {f.opponent}
                          <span style={{ color: T.inkSoft }}> — {formatDisplayTime(f.kickoffTime)}{f.venue ? `, ${f.venue}` : ""}</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="gfc-field">
            <label className="gfc-label">Date range subtitle</label>
            <input className="gfc-input" value={dateRangeLabel} onChange={(e) => setDateRangeLabel(e.target.value)} />
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Social handle</label>
              <input className="gfc-input" value={handle} onChange={(e) => setHandle(e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Hashtag</label>
              <input className="gfc-input" value={hashtag} onChange={(e) => setHashtag(e.target.value)} />
            </div>
          </div>

          <div className="gfc-panel-title" style={{ marginTop: 16, marginBottom: 10 }}>Tuckshop menu (poster only)</div>
          <div className="gfc-field">
            <label className="gfc-label">Items available <span style={{ fontWeight: 400, textTransform: "none", color: T.inkSoft }}>(comma or line separated, optional)</span></label>
            <textarea
              className="gfc-textarea"
              rows={2}
              placeholder="Chips, Chocolates, Cooldrinks, Boerewors rolls"
              value={tuckshopText}
              onChange={(e) => setTuckshopText(e.target.value)}
            />
          </div>

          <div className="gfc-panel-title" style={{ marginTop: 16, marginBottom: 10 }}>PDF footer (weekly sheet only)</div>
          <div className="gfc-field">
            <label className="gfc-label">Footer notice 1</label>
            <input className="gfc-input" value={footerNotice1} onChange={(e) => setFooterNotice1(e.target.value)} />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Footer notice 2</label>
            <input className="gfc-input" value={footerNotice2} onChange={(e) => setFooterNotice2(e.target.value)} />
          </div>
          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label">Contact name</label>
              <input className="gfc-input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="gfc-field">
              <label className="gfc-label">Contact phone</label>
              <input className="gfc-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <PosterPreviewFrame>
          <div ref={posterRef}>
            <FixturePoster groups={groups} dateRangeLabel={dateRangeLabel} handle={handle} hashtag={hashtag} tuckshopItems={tuckshopItems} />
          </div>
        </PosterPreviewFrame>
      </div>
    </div>
  );
}

function PosterPreviewFrame({ children = null }) {
  const outerRef = React.useRef(null);
  const innerRef = React.useRef(null);
  const [scale, setScale] = useState(1);
  const [innerHeight, setInnerHeight] = useState(0);

  useEffect(() => {
    function recompute() {
      if (!outerRef.current || !innerRef.current) return;
      const availableWidth = outerRef.current.clientWidth;
      const naturalWidth = 1080;
      const s = Math.min(1, availableWidth / naturalWidth);
      setScale(s);
      setInnerHeight(innerRef.current.scrollHeight);
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (outerRef.current) ro.observe(outerRef.current);
    const mo = new MutationObserver(recompute);
    if (innerRef.current) mo.observe(innerRef.current, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  return (
    <div ref={outerRef} className="gfc-panel" style={{ padding: 12, overflow: "hidden" }}>
      <div style={{ height: innerHeight * scale || "auto" }}>
        <div ref={innerRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: 1080 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FixturePoster({ groups, dateRangeLabel, handle, hashtag, tuckshopItems }) {
  return (
    <div
      style={{
        width: 1080,
        background: "linear-gradient(155deg, #0d0a1f 0%, #1a1338 45%, #123322 100%)",
        padding: 48,
        display: "flex",
        gap: 40,
        fontFamily: "'Karla', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: -120, left: -120, width: 400, height: 400, background: "radial-gradient(circle, rgba(232,172,46,0.18), transparent 70%)" }} />
      <div style={{ position: "absolute", bottom: -140, right: -140, width: 460, height: 460, background: "radial-gradient(circle, rgba(30,122,65,0.28), transparent 70%)" }} />

      {/* LEFT: branding */}
      <div style={{ width: 380, flexShrink: 0, position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ color: T.gold, fontFamily: "'Anton', sans-serif", fontSize: 26, letterSpacing: 2 }}>GARLANDALE FC</div>
        <div style={{ color: "#fff", fontFamily: "'Anton', sans-serif", fontSize: 84, lineHeight: 0.95, marginTop: 4, textTransform: "uppercase" }}>Fixtures</div>
        <div style={{ display: "inline-block", marginTop: 18, background: T.green, color: "#fff", fontWeight: 800, fontSize: 20, padding: "8px 16px", borderRadius: 4, alignSelf: "center" }}>
          {dateRangeLabel}
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "30px 0" }}>
          <img src={BADGE_SRC} alt="Garlandale FC crest" style={{ width: 260, height: 260 }} />
        </div>

        <div style={{ display: "flex", gap: 14, color: "#fff", fontSize: 13, fontWeight: 700, flexWrap: "wrap", justifyContent: "center" }}>
          <span>👥 TOGETHER</span>
          <span style={{ color: T.gold }}>|</span>
          <span>❤️ PASSION</span>
          <span style={{ color: T.gold }}>|</span>
          <span>📈 PROGRESS</span>
        </div>
        <div style={{ marginTop: 10, color: "#fff", fontSize: 14, fontWeight: 700 }}>
          📷 📘 {handle}
        </div>
        <div style={{ marginTop: 14, fontFamily: "'Anton', sans-serif", fontSize: 30 }}>
          <span style={{ color: "#fff" }}>{hashtag.replace(/garlandale/i, "").toUpperCase() === hashtag.toUpperCase() ? hashtag : hashtag}</span>
        </div>
      </div>

      {/* RIGHT: fixture groups */}
      <div style={{ flex: 1, position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
        {groups.length === 0 && (
          <div style={{ color: "#fff", opacity: 0.6, fontSize: 16, padding: 20 }}>
            Select fixtures on the left to see them appear here.
          </div>
        )}
        {groups.map((g, gi) => (
          <div key={gi} style={{ borderRadius: 6, overflow: "hidden", border: "1px solid rgba(232,172,46,0.4)" }}>
            <div style={{ background: T.green, color: "#fff", fontWeight: 800, fontSize: 19, padding: "10px 16px", textTransform: "uppercase", letterSpacing: 0.5 }}>
              📅 {formatFixtureHeader(g.headerRaw)}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0d0a1f" }}>
                  {["Team", "Vs", "Time", "Venue"].map((h) => (
                    <th key={h} style={{ color: T.gold, textTransform: "uppercase", fontSize: 12, fontWeight: 800, padding: "8px 12px", textAlign: "left", borderBottom: "1px solid rgba(232,172,46,0.3)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#161029" : "#1c1738" }}>
                    <td style={{ color: "#fff", fontWeight: 700, fontSize: 14, padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{r.team}</td>
                    <td style={{ color: "#fff", fontSize: 14, padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{r.vs}</td>
                    <td style={{ color: T.gold, fontWeight: 800, fontSize: 14, padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{r.time}</td>
                    <td style={{ color: "#fff", fontSize: 14, padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{r.venue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {tuckshopItems && tuckshopItems.length > 0 && (
          <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid rgba(232,172,46,0.4)" }}>
            <div style={{ background: T.green, color: "#fff", fontWeight: 800, fontSize: 19, padding: "10px 16px", textTransform: "uppercase", letterSpacing: 0.5 }}>
              🍟 Tuckshop Menu
            </div>
            <div style={{ background: "#161029", padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 10 }}>
              {tuckshopItems.map((item, i) => (
                <span
                  key={i}
                  style={{
                    background: "#1c1738", color: "#fff", fontWeight: 700, fontSize: 14,
                    padding: "6px 14px", borderRadius: 999, border: `1px solid ${T.gold}`,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
