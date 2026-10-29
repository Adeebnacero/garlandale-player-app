import React, { useState, useEffect, useMemo, useCallback } from "react";
import { T } from "../theme.js";
import { LocationFields } from "./shared.jsx";
import { checkLocationFields } from "../lib/mapLinks.js";
import {
  WEEKDAYS, MONTHS, MON3, REPEAT_OPTIONS, PALETTE, MAX_OCCURRENCES,
  todayKey, parseKey, firstOfMonth, longDate, timeLabel, occurrences, repeatLabel, lowerFirst,
  monthGrid, weekDates, periodLabel, shiftCursor, sortItems, groupByDate,
  categoryFor, fixtureCategory, categoryNameError, fixtureItems, eventItem,
  blankEventForm, eventFormError, noticeText,
} from "../lib/calendar.js";
import {
  loadCalendar, createEvents, updateOneEvent, updateSeriesFrom, deleteEvent, deleteSeriesFrom,
  setSeriesUntil, linkNotice, postCalendarNotice, saveCategory, deleteCategory,
} from "../lib/calendarApi.js";

// ---------------------------------------------------------------------------
// Calendar tab. Club events (managed here by Admin, Chairman and Treasurer)
// and fixtures (from the Fixtures tab, plus Matchday-only entries) in a
// week, month or year view. Everything shown here is also shown to every
// guardian and approved supporter in the Player Portal's Club calendar.
// ---------------------------------------------------------------------------

const CSS = `
.cal-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border: 1px solid ${T.line}; border-radius: 12px; padding: 10px 12px; margin-bottom: 14px; }
.cal-nav { display: flex; align-items: center; gap: 6px; }
.cal-iconbtn { width: 36px; height: 36px; border-radius: 8px; border: 1px solid ${T.line}; background: #fff; color: ${T.indigo}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700; }
.cal-iconbtn:hover { background: ${T.paperDim}; }
.cal-period { font-family: 'Anton', sans-serif; font-size: 20px; letter-spacing: .02em; text-transform: uppercase; color: ${T.indigo}; margin: 0 0 0 6px; }
.cal-seg { display: flex; background: ${T.paperDim}; border-radius: 9px; padding: 3px; gap: 3px; }
.cal-seg button { border: 0; border-radius: 7px; padding: 7px 16px; font: 700 12.5px 'Karla', sans-serif; cursor: pointer; background: transparent; color: ${T.inkSoft}; }
.cal-seg button[aria-pressed="true"] { background: ${T.indigo}; color: #fff; }
.cal-legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 14px; }
.cal-legend span { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${T.inkSoft}; }
.cal-swatch { width: 11px; height: 11px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); display: inline-block; }
.cal-layout { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.cal-main { flex: 999 1 600px; min-width: 0; overflow-x: auto; }
.cal-side { flex: 1 1 260px; min-width: 0; background: #fff; border: 1px solid ${T.line}; border-radius: 12px; padding: 16px; }
.cal-side h3 { font-family: 'Anton', sans-serif; font-weight: 400; font-size: 17px; letter-spacing: .02em; text-transform: uppercase; color: ${T.indigo}; margin: 0 0 12px; }
.cal-month { min-width: 700px; background: #fff; border: 1px solid ${T.line}; border-radius: 12px; overflow: hidden; }
.cal-month-head, .cal-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cal-month-head { background: ${T.indigo}; color: #fff; }
.cal-month-head div { padding: 8px 10px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.cal-cell { min-height: 112px; padding: 5px; display: flex; flex-direction: column; gap: 3px; border-right: 1px solid ${T.paperDim}; border-bottom: 1px solid ${T.paperDim}; min-width: 0; background: #fff; }
.cal-cell.out { background: ${T.paper}; }
.cal-daynum { width: 28px; height: 28px; border-radius: 999px; border: 0; background: transparent; font: 700 12.5px 'Karla', sans-serif; color: ${T.ink}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.cal-cell.out .cal-daynum { color: #9a93a8; }
.cal-daynum.today { background: ${T.gold}; color: ${T.indigo}; }
.cal-daynum:hover { box-shadow: inset 0 0 0 1.5px ${T.indigo}; }
.cal-chip { display: block; width: 100%; text-align: left; border: 0; border-radius: 5px; padding: 3px 6px; font: 600 11.5px/1.35 'Karla', sans-serif; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-more { background: transparent; border: 0; padding: 1px 4px; text-align: left; font: 700 11.5px 'Karla', sans-serif; color: ${T.indigo}; cursor: pointer; }
.cal-week { min-width: 700px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.cal-wcol { min-height: 380px; background: #fff; border: 1px solid ${T.line}; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.cal-wcol.today { border: 2px solid ${T.gold}; }
.cal-whead { display: flex; flex-direction: column; gap: 1px; padding-bottom: 7px; border-bottom: 1px solid ${T.line}; }
.cal-whead span:first-child { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${T.inkSoft}; }
.cal-whead span:last-child { font-family: 'Anton', sans-serif; font-size: 19px; color: ${T.indigo}; }
.cal-wcard { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 0; border-radius: 9px; padding: 7px 9px; cursor: pointer; font-family: 'Karla', sans-serif; }
.cal-wcard b { font-size: 13px; line-height: 1.25; }
.cal-wcard small { font-size: 11.5px; opacity: .92; }
.cal-wadd { margin-top: auto; background: transparent; border: 1px dashed #c9c0a8; border-radius: 8px; padding: 7px; font: 700 12px 'Karla', sans-serif; color: ${T.inkSoft}; cursor: pointer; }
.cal-year { min-width: 700px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.cal-ymonth { background: #fff; border: 1px solid ${T.line}; border-radius: 12px; padding: 12px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 8px; color: ${T.ink}; font-family: 'Karla', sans-serif; }
.cal-ymonth:hover { border-color: ${T.indigo}; }
.cal-ymonth-head { display: flex; justify-content: space-between; align-items: baseline; }
.cal-ymonth-head b { font-family: 'Anton', sans-serif; font-weight: 400; font-size: 16px; letter-spacing: .02em; text-transform: uppercase; color: ${T.indigo}; }
.cal-ymonth-head span { font-size: 11px; font-weight: 700; color: ${T.inkSoft}; }
.cal-ygrid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.cal-ygrid span { height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 10.5px; font-weight: 600; color: ${T.inkSoft}; }
.cal-up { display: flex; gap: 10px; align-items: flex-start; text-align: left; background: transparent; border: 0; border-bottom: 1px solid ${T.paperDim}; padding: 0 0 10px; margin: 0 0 10px; cursor: pointer; width: 100%; color: ${T.ink}; font-family: 'Karla', sans-serif; }
.cal-up-date { flex: 0 0 44px; display: flex; flex-direction: column; align-items: center; background: ${T.paper}; border-radius: 9px; padding: 5px 0; }
.cal-up-date b { font-family: 'Anton', sans-serif; font-weight: 400; font-size: 18px; line-height: 1; color: ${T.indigo}; }
.cal-up-date span { font-size: 10px; font-weight: 700; text-transform: uppercase; color: ${T.inkSoft}; }
.cal-badge { display: inline-block; align-self: flex-start; border-radius: 999px; padding: 2px 9px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.cal-dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 7px 12px; font-size: 13.5px; margin: 12px 0; }
.cal-dl dt { color: ${T.inkSoft}; font-weight: 600; }
.cal-dl dd { margin: 0; }
.cal-box { background: ${T.paperDim}; border-radius: 9px; padding: 10px 12px; font-size: 12.5px; color: ${T.ink}; margin: 0 0 12px; }
.cal-ok { background: ${T.greenSoft}; color: #155c30; border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 600; margin: 0 0 12px; }
.cal-err { background: ${T.dangerSoft}; color: #9a2f28; border-radius: 9px; padding: 9px 12px; font-size: 12.5px; font-weight: 600; margin: 0 0 12px; }
.cal-hint { font-size: 11.5px; color: ${T.inkSoft}; margin-top: 4px; }
.cal-subpanel { background: ${T.paper}; border: 1px solid ${T.line}; border-radius: 9px; padding: 12px; margin-bottom: 14px; }
.cal-check { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; cursor: pointer; }
.cal-check input { margin-top: 2px; accent-color: ${T.green}; width: 16px; height: 16px; }
.cal-preview { background: #fff; border: 1px solid ${T.line}; border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 12.5px; white-space: pre-wrap; }
.cal-catrow { border: 1px solid ${T.line}; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.cal-catrow-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cal-catpill { flex: 0 0 auto; min-width: 92px; text-align: center; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.cal-swatches { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.cal-swatches button { width: 26px; height: 26px; border-radius: 7px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
.cal-swatches button[aria-pressed="true"] { box-shadow: 0 0 0 2px #fff, 0 0 0 4px ${T.indigo}; }
.cal-tag { font-size: 11px; color: ${T.inkSoft}; font-weight: 600; background: ${T.paperDim}; border-radius: 999px; padding: 3px 9px; }
.cal-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: ${T.indigo}; color: #fff; padding: 11px 18px; border-radius: 10px; font-size: 13.5px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,.25); z-index: 60; max-width: 90vw; }
.cal-toast.warn { background: #8a5c0f; }
.cal-daynum:focus-visible, .cal-chip:focus-visible, .cal-wcard:focus-visible, .cal-ymonth:focus-visible, .cal-up:focus-visible, .cal-seg button:focus-visible, .cal-iconbtn:focus-visible, .cal-swatches button:focus-visible { outline: 3px solid ${T.gold}; outline-offset: 2px; }
`;

function chipStyle(cat) {
  return { background: cat.color, color: cat.textColor };
}

export function CalendarView({ role, staffId, fixtures, matches, onOpenTab }) {
  const canEdit = role === "admin" || role === "treasurer"; // a Chairman's access role is "admin"
  const today = todayKey();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(today);
  const [modal, setModal] = useState(null); // { type: "view"|"form"|"delete"|"categories", ... }
  const [toast, setToast] = useState(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadCalendar());
      setLoadError("");
    } catch (e) {
      setLoadError(e.message || "Couldn't load the calendar.");
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.warn ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const categories = data ? data.categories : [];
  const events = data ? data.events : [];

  const items = useMemo(() => {
    const fx = fixtureItems(fixtures, matches);
    return sortItems([...fx, ...events.map(eventItem)]);
  }, [fixtures, matches, events]);
  const byDate = useMemo(() => groupByDate(items), [items]);

  const catOf = useCallback(
    (item) => (item.kind === "fixture" ? fixtureCategory(categories) : categoryFor(categories, item.categoryId)),
    [categories],
  );

  const openItem = (item) => setModal({ type: "view", item });
  const openNew = (date) => setModal({ type: "form", form: blankEventForm(date, categories), original: null });

  return (
    <div>
      <style>{CSS}</style>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Calendar</div>
          <div className="gfc-page-sub">Club events and fixtures. Everything here is visible to all guardians and supporters in the Player Portal.</div>
        </div>
        {canEdit ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="gfc-btn gfc-btn-outline" onClick={() => setModal({ type: "categories" })} disabled={!data}>Categories</button>
            <button className="gfc-btn gfc-btn-primary" onClick={() => openNew(today)} disabled={!data}>+ Add event</button>
          </div>
        ) : (
          <div className="cal-tag">View only. An Admin, Chairman or Treasurer can add events.</div>
        )}
      </div>

      {loadError && (
        <div className="cal-err">
          {loadError}{" "}
          {/relation .*calendar_/i.test(loadError) && "Run migrations/2026-10-club-calendar.sql in the Supabase SQL Editor first. "}
          <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={reload}>Try again</button>
        </div>
      )}

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button className="cal-iconbtn" aria-label="Previous" onClick={() => setCursor((c) => shiftCursor(view, c, -1))}>‹</button>
          <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => setCursor(today)}>Today</button>
          <button className="cal-iconbtn" aria-label="Next" onClick={() => setCursor((c) => shiftCursor(view, c, 1))}>›</button>
          <h2 className="cal-period">{periodLabel(view, cursor)}</h2>
        </div>
        <div className="cal-seg" role="group" aria-label="View">
          {[["week", "Week"], ["month", "Month"], ["year", "Year"]].map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="cal-legend">
        {categories.map((c) => (
          <span key={c.id}><i className="cal-swatch" style={{ background: c.color }} />{c.name}</span>
        ))}
      </div>

      <div className="cal-layout">
        <section className="cal-main" aria-label="Calendar">
          {view === "month" && (
            <MonthView cursor={cursor} today={today} byDate={byDate} catOf={catOf} canEdit={canEdit}
              onOpen={openItem} onAdd={openNew} onShowWeek={(d) => { setCursor(d); setView("week"); }} />
          )}
          {view === "week" && (
            <WeekView cursor={cursor} today={today} byDate={byDate} catOf={catOf} canEdit={canEdit} onOpen={openItem} onAdd={openNew} />
          )}
          {view === "year" && (
            <YearView cursor={cursor} today={today} byDate={byDate} catOf={catOf}
              onOpenMonth={(d) => { setCursor(d); setView("month"); }} />
          )}
        </section>
        <aside className="cal-side" aria-label="Upcoming">
          <h3>Upcoming</h3>
          <Upcoming items={items.filter((i) => i.date >= today).slice(0, 8)} catOf={catOf} onOpen={openItem} />
        </aside>
      </div>

      {modal?.type === "view" && (
        <DetailModal
          item={modal.item}
          cat={catOf(modal.item)}
          canEdit={canEdit}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: "form", form: { ...blankEventForm(modal.item.date, categories), ...modal.item, scope: "one", notify: false }, original: modal.item })}
          onDelete={() => setModal({ type: "delete", item: modal.item })}
          onOpenTab={(t) => { setModal(null); onOpenTab(t); }}
        />
      )}
      {modal?.type === "form" && (
        <EventFormModal
          initial={modal.form}
          original={modal.original}
          categories={categories}
          events={events}
          staffId={staffId}
          onClose={() => setModal(null)}
          onDone={async (message, warn, date) => { setModal(null); setToast({ message, warn }); if (date) setCursor(date); await reload(); }}
        />
      )}
      {modal?.type === "delete" && (
        <DeleteModal
          item={modal.item}
          events={events}
          staffId={staffId}
          onClose={() => setModal({ type: "view", item: modal.item })}
          onDone={async (message, warn) => { setModal(null); setToast({ message, warn }); await reload(); }}
        />
      )}
      {modal?.type === "categories" && (
        <CategoriesModal categories={categories} events={events} onChanged={reload} onClose={() => setModal(null)} />
      )}
      {toast && <div className={`cal-toast${toast.warn ? " warn" : ""}`} role="status">{toast.message}</div>}
    </div>
  );
}

/* ---------- views ---------- */

function MonthView({ cursor, today, byDate, catOf, canEdit, onOpen, onAdd, onShowWeek }) {
  const month = parseKey(cursor).getMonth();
  return (
    <div className="cal-month">
      <div className="cal-month-head">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="cal-month-grid">
        {monthGrid(cursor).map((d) => {
          const list = byDate[d] || [];
          const inMonth = parseKey(d).getMonth() === month;
          return (
            <div key={d} className={`cal-cell${inMonth ? "" : " out"}`}>
              <div>
                <button
                  className={`cal-daynum${d === today ? " today" : ""}`}
                  aria-label={canEdit ? `Add an event on ${longDate(d)}` : `Show the week of ${longDate(d)}`}
                  title={canEdit ? "Add an event on this day" : undefined}
                  onClick={() => (canEdit ? onAdd(d) : onShowWeek(d))}
                >
                  {parseKey(d).getDate()}
                </button>
              </div>
              {list.slice(0, 3).map((it) => (
                <button key={it.id} className="cal-chip" style={chipStyle(catOf(it))} title={it.title} onClick={() => onOpen(it)}>
                  {it.allDay ? "" : `${it.start} `}{it.title}
                </button>
              ))}
              {list.length > 3 && (
                <button className="cal-more" onClick={() => onShowWeek(d)}>+{list.length - 3} more</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ cursor, today, byDate, catOf, canEdit, onOpen, onAdd }) {
  return (
    <div className="cal-week">
      {weekDates(cursor).map((d, i) => {
        const list = byDate[d] || [];
        const dt = parseKey(d);
        return (
          <div key={d} className={`cal-wcol${d === today ? " today" : ""}`}>
            <div className="cal-whead"><span>{WEEKDAYS[i]}</span><span>{dt.getDate()} {MON3[dt.getMonth()]}</span></div>
            {list.map((it) => (
              <button key={it.id} className="cal-wcard" style={chipStyle(catOf(it))} onClick={() => onOpen(it)}>
                <small><b style={{ fontSize: 11.5 }}>{timeLabel(it)}</b></small>
                <b>{it.title}</b>
                {it.venue && <small>{it.venue}</small>}
                {it.seriesId && <small>{repeatLabel(it.repeatRule, it.repeatUntil)}</small>}
              </button>
            ))}
            {list.length === 0 && <span style={{ fontSize: 12.5, color: "#8a8399" }}>No events</span>}
            {canEdit && <button className="cal-wadd" onClick={() => onAdd(d)}>+ Add</button>}
          </div>
        );
      })}
    </div>
  );
}

function YearView({ cursor, today, byDate, catOf, onOpenMonth }) {
  const year = parseKey(cursor).getFullYear();
  return (
    <div className="cal-year">
      {MONTHS.map((name, m) => {
        const first = `${year}-${String(m + 1).padStart(2, "0")}-01`;
        const lead = (parseKey(first).getDay() + 6) % 7;
        const days = new Date(year, m + 1, 0).getDate();
        let total = 0;
        const cells = [];
        for (let b = 0; b < lead; b++) cells.push(<span key={`b${b}`} />);
        for (let day = 1; day <= days; day++) {
          const k = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const list = byDate[k] || [];
          total += list.length;
          const pick = list.find((it) => it.kind === "fixture") || list[0];
          const style = pick ? chipStyle(catOf(pick)) : {};
          if (k === today) style.boxShadow = `0 0 0 2px ${T.gold}`;
          cells.push(<span key={k} style={style}>{day}</span>);
        }
        return (
          <button key={name} className="cal-ymonth" onClick={() => onOpenMonth(firstOfMonth(first))}
            aria-label={`${name} ${year}, ${total} ${total === 1 ? "item" : "items"}. Open month`}>
            <span className="cal-ymonth-head"><b>{name}</b><span>{total ? `${total} ${total === 1 ? "item" : "items"}` : "Nothing yet"}</span></span>
            <span className="cal-ygrid">{cells}</span>
          </button>
        );
      })}
    </div>
  );
}

function Upcoming({ items, catOf, onOpen }) {
  if (!items.length) return <div style={{ fontSize: 13, color: T.inkSoft }}>Nothing coming up. Add an event to get started.</div>;
  return items.map((it) => {
    const d = parseKey(it.date);
    const cat = catOf(it);
    return (
      <button key={it.id} className="cal-up" onClick={() => onOpen(it)}>
        <span className="cal-up-date"><b>{d.getDate()}</b><span>{MON3[d.getMonth()]}</span></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span className="cal-badge" style={chipStyle(cat)}>{cat.name}</span>
          <b style={{ fontSize: 13.5, lineHeight: 1.25 }}>{it.title}</b>
          <span style={{ fontSize: 12, color: T.inkSoft }}>{timeLabel(it)}{it.venue ? `, ${it.venue}` : ""}</span>
        </span>
      </button>
    );
  });
}

/* ---------- event details ---------- */

function DetailModal({ item, cat, canEdit, onClose, onEdit, onDelete, onOpenTab }) {
  const isFixture = item.kind === "fixture";
  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" role="dialog" aria-modal="true" aria-label={item.title} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{isFixture ? "Fixture" : "Event"}</div>
          <button className="gfc-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <span className="cal-badge" style={chipStyle(cat)}>{cat.name}</span>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25, marginTop: 8 }}>{item.title}</div>
        <dl className="cal-dl">
          <dt>Date</dt><dd>{longDate(item.date)}</dd>
          <dt>Time</dt><dd>{timeLabel(item)}</dd>
          <dt>Venue</dt><dd>{item.venue || "—"}</dd>
          {item.seriesId && (<><dt>Repeats</dt><dd>{repeatLabel(item.repeatRule, item.repeatUntil)}</dd></>)}
          {isFixture && item.team && (<><dt>Team</dt><dd>{item.team}{item.homeAway === "A" ? ", away" : ", home"}</dd></>)}
          {(item.locationLink || item.locationEmbed) && (<><dt>Location</dt><dd>{item.locationLink ? <a href={item.locationLink} target="_blank" rel="noopener noreferrer">Directions</a> : "Map added"}</dd></>)}
        </dl>
        {item.description && <p style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", margin: "0 0 12px" }}>{item.description}</p>}
        {item.noticeId && <div className="cal-ok">Posted to the Notice Board</div>}
        {isFixture && (
          <div className="cal-box">
            {item.source === "fixtures"
              ? "This fixture comes from the Fixtures tab. Change or delete it there and the calendar updates."
              : "This match was added in Matchday. Change or delete it there and the calendar updates."}
          </div>
        )}
        <div className="gfc-modal-actions">
          {!isFixture && canEdit && (
            <button className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={onDelete}>Delete</button>
          )}
          <button className="gfc-btn gfc-btn-ghost" onClick={onClose}>Close</button>
          {!isFixture && canEdit && <button className="gfc-btn gfc-btn-primary" onClick={onEdit}>Edit event</button>}
          {isFixture && (
            <button className="gfc-btn gfc-btn-outline" onClick={() => onOpenTab(item.source === "fixtures" ? "fixtures" : "matchday")}>
              Open in {item.source === "fixtures" ? "Fixtures" : "Matchday"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- add / edit ---------- */

function EventFormModal({ initial, original, categories, events, staffId, onClose, onDone }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNew = !original;
  const isSeries = !isNew && !!original.seriesId;
  const following = isSeries && form.scope === "following";
  const choosable = categories.filter((c) => c.isSystem !== "fixture");

  function update(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "repeatRule" && value !== "none" && !f.repeatUntil) {
        const d = parseKey(f.date);
        d.setDate(d.getDate() + 56);
        next.repeatUntil = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      return next;
    });
    setError("");
  }

  const dates = isNew ? occurrences(form.date, form.repeatRule, form.repeatUntil) : [form.date];
  const series = isNew
    ? (dates.length > 1 ? { rule: form.repeatRule, until: form.repeatUntil, fromDate: form.date, count: dates.length } : null)
    : (following ? { rule: original.repeatRule, until: original.repeatUntil, fromDate: original.date, count: 2 } : null);
  const preview = noticeText(isNew ? "new" : "update", following ? { ...form, date: original.date } : form, { series });

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = eventFormError(following ? { ...form, date: original.date } : form);
    if (problem) { setError(problem); return; }
    const loc = checkLocationFields(form);
    if (!loc.ok) { setError(loc.errors.link || loc.errors.embed); return; }
    const clean = { ...form, locationLink: loc.locationLink, locationEmbed: loc.locationEmbed };
    setBusy(true);
    setError("");
    let ids = [];
    let message = "";
    try {
      if (isNew) {
        const created = await createEvents(clean, dates);
        ids = created.map((c) => c.id);
        message = created.length > 1 ? `${created.length} events added` : "Event added";
      } else if (following) {
        const n = await updateSeriesFrom(clean, original.date);
        ids = events.filter((ev) => ev.seriesId === original.seriesId && ev.date >= original.date).map((ev) => ev.id);
        message = `${n} events updated`;
      } else {
        await updateOneEvent(clean);
        ids = [clean.id];
        message = "Changes saved";
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (clean.notify) {
      try {
        const noticeId = await postCalendarNotice({ ...preview, locationLink: clean.locationLink, locationEmbed: clean.locationEmbed }, staffId);
        await linkNotice(ids, noticeId);
        message += " and posted to the Notice Board";
      } catch (err) {
        await onDone(`${message}, but the notice couldn't be posted: ${err.message}`, true, form.date);
        return;
      }
    }
    await onDone(message, false, following ? original.date : form.date);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label={isNew ? "Add event" : "Edit event"} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{isNew ? "Add event" : "Edit event"}</div>
          <button className="gfc-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label" htmlFor="cal-title">Event title</label>
            <input id="cal-title" className="gfc-input" value={form.title} maxLength={120} placeholder="e.g. Committee meeting" onChange={(e) => update("title", e.target.value)} autoFocus />
          </div>

          {isSeries && (
            <div className="cal-subpanel">
              <label className="gfc-label" htmlFor="cal-scope">Apply changes to</label>
              <select id="cal-scope" className="gfc-select" value={form.scope} onChange={(e) => update("scope", e.target.value)}>
                <option value="one">This date only</option>
                <option value="following">This date and every later one</option>
              </select>
              <div className="cal-hint">
                Part of a repeating event: {lowerFirst(repeatLabel(original.repeatRule, original.repeatUntil))}.
                {form.scope === "one" ? " Saving takes this date out of the repeat." : " Dates stay as they are; everything else changes."}
              </div>
            </div>
          )}

          <div className="gfc-row2">
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="cal-cat">Category</label>
              <select id="cal-cat" className="gfc-select" value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)}>
                {choosable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="cal-date">{isNew && form.repeatRule !== "none" ? "First date" : "Date"}</label>
              <input id="cal-date" type="date" className="gfc-input" value={following ? original.date : form.date} disabled={following} onChange={(e) => update("date", e.target.value)} />
            </div>
          </div>

          <label className="cal-check" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={form.allDay} onChange={(e) => update("allDay", e.target.checked)} />
            <span>All-day event</span>
          </label>
          {!form.allDay && (
            <div className="gfc-row2">
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="cal-start">Starts</label>
                <input id="cal-start" type="time" className="gfc-input" value={form.start} onChange={(e) => update("start", e.target.value)} />
              </div>
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="cal-end">Ends (optional)</label>
                <input id="cal-end" type="time" className="gfc-input" value={form.end} onChange={(e) => update("end", e.target.value)} />
              </div>
            </div>
          )}

          {isNew && (
            <div className="cal-subpanel">
              <div className="gfc-row2">
                <div className="gfc-field" style={{ marginBottom: 0 }}>
                  <label className="gfc-label" htmlFor="cal-repeat">Repeats</label>
                  <select id="cal-repeat" className="gfc-select" value={form.repeatRule} onChange={(e) => update("repeatRule", e.target.value)}>
                    {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {form.repeatRule !== "none" && (
                  <div className="gfc-field" style={{ marginBottom: 0 }}>
                    <label className="gfc-label" htmlFor="cal-until">Until</label>
                    <input id="cal-until" type="date" className="gfc-input" value={form.repeatUntil} min={form.date} onChange={(e) => update("repeatUntil", e.target.value)} />
                  </div>
                )}
              </div>
              {form.repeatRule !== "none" && (
                <div className="cal-hint" style={{ color: dates.length > 1 ? T.green : T.inkSoft, fontWeight: 600 }}>
                  {dates.length > 1
                    ? `Creates ${dates.length} events, the last on ${longDate(dates[dates.length - 1])}.${dates.length >= MAX_OCCURRENCES ? ` That's the most one repeat can make.` : ""}`
                    : "Pick an Until date after the first date."}
                </div>
              )}
            </div>
          )}

          <div className="gfc-field">
            <label className="gfc-label" htmlFor="cal-venue">Venue</label>
            <input id="cal-venue" className="gfc-input" value={form.venue} maxLength={200} placeholder="e.g. Clubhouse" onChange={(e) => update("venue", e.target.value)} />
          </div>
          <LocationFields link={form.locationLink} embed={form.locationEmbed} onChange={update} />
          <div className="gfc-field">
            <label className="gfc-label" htmlFor="cal-desc">Details (optional)</label>
            <textarea id="cal-desc" className="gfc-textarea" rows={3} maxLength={2000} value={form.description} placeholder="What guardians need to know" onChange={(e) => update("description", e.target.value)} />
          </div>

          <div className="cal-subpanel">
            <label className="cal-check">
              <input type="checkbox" checked={form.notify} onChange={(e) => update("notify", e.target.checked)} />
              <span>
                <b>{isNew ? "Also post to the Notice Board" : "Post an update to the Notice Board"}</b>
                <span className="cal-hint" style={{ display: "block" }}>Guardians and supporters see it on the Notice Board, with the unread badge.</span>
              </span>
            </label>
            {form.notify && <div className="cal-preview"><b>{preview.title}</b>{"\n"}{preview.body}</div>}
          </div>

          <div className="cal-hint" style={{ marginBottom: 6 }}>Visible to everyone in the Player Portal. Fixtures are added in the Fixtures tab.</div>
          {error && <div className="cal-err" role="alert">{error}</div>}
          <div className="gfc-modal-actions">
            <button type="button" className="gfc-btn gfc-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="gfc-btn gfc-btn-primary" disabled={busy}>
              {busy ? "Saving…" : isNew ? (dates.length > 1 ? `Add ${dates.length} events` : "Add event") : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- delete ---------- */

function DeleteModal({ item, events, staffId, onClose, onDone }) {
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seriesRest = item.seriesId ? events.filter((e) => e.seriesId === item.seriesId && e.date >= item.date) : [];

  async function run(mode) {
    setBusy(true);
    setError("");
    let message = "";
    let series = null;
    try {
      const remaining = item.seriesId
        ? events.filter((e) => e.seriesId === item.seriesId && (mode === "following" ? e.date < item.date : e.id !== item.id))
        : [];
      if (mode === "following") {
        const n = await deleteSeriesFrom(item.seriesId, item.date);
        message = `${n} events deleted`;
        series = { rule: item.repeatRule, until: item.repeatUntil, fromDate: item.date };
      } else {
        await deleteEvent(item.id);
        message = "Event deleted";
      }
      if (item.seriesId && remaining.length) {
        const last = remaining.map((e) => e.date).sort().pop();
        if (last !== item.repeatUntil) await setSeriesUntil(item.seriesId, last);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (notify) {
      try {
        await postCalendarNotice({ ...noticeText("cancel", item, { series }), locationLink: "", locationEmbed: "" }, staffId);
        message += " and the cancellation posted to the Notice Board";
      } catch (err) {
        await onDone(`${message}, but the notice couldn't be posted: ${err.message}`, true);
        return;
      }
    }
    await onDone(message, false);
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" role="dialog" aria-modal="true" aria-label="Delete event" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">Delete event</div>
          <button className="gfc-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 12px" }}>
          Delete <b>{item.title}</b> on {longDate(item.date)}? It disappears from the Player Portal straight away.
        </p>
        {item.seriesId && (
          <div className="cal-box">
            Part of a repeating event ({lowerFirst(repeatLabel(item.repeatRule, item.repeatUntil))}).
            {seriesRest.length > 1 ? ` This date and the ${seriesRest.length - 1} after it can be deleted together.` : ""}
          </div>
        )}
        <label className="cal-check" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            <b>Let everyone know it's cancelled</b>
            <span className="cal-hint" style={{ display: "block" }}>Posts a notice and shows the unread badge in the Player Portal.</span>
          </span>
        </label>
        {error && <div className="cal-err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        <div className="gfc-modal-actions" style={{ flexWrap: "wrap" }}>
          <button className="gfc-btn gfc-btn-ghost" onClick={onClose} disabled={busy}>Keep it</button>
          {item.seriesId && seriesRest.length > 1 && (
            <button className="gfc-btn gfc-btn-outline" style={{ color: T.danger, borderColor: T.danger }} onClick={() => run("following")} disabled={busy}>
              Delete this and later dates
            </button>
          )}
          <button className="gfc-btn gfc-btn-danger" onClick={() => run("one")} disabled={busy}>
            {busy ? "Deleting…" : item.seriesId ? "Delete this date only" : "Delete event"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- categories ---------- */

function CategoriesModal({ categories, events, onChanged, onClose }) {
  const [names, setNames] = useState(() => Object.fromEntries(categories.map((c) => [c.id, c.name])));
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setNames((prev) => {
      const next = { ...prev };
      for (const c of categories) if (!(c.id in next)) next[c.id] = c.name;
      return next;
    });
  }, [categories]);

  const usage = useMemo(() => {
    const u = {};
    for (const e of events) u[e.categoryId] = (u[e.categoryId] || 0) + 1;
    return u;
  }, [events]);
  const otherName = (categories.find((c) => c.isSystem === "other") || { name: "Other" }).name;

  async function save(cat, patch) {
    const next = { ...cat, ...patch };
    if (patch.name !== undefined) {
      const problem = categoryNameError(next.name, categories, cat.id);
      if (problem) { setError(problem); setNames((n) => ({ ...n, [cat.id]: cat.name })); return; }
      if (next.name.trim() === cat.name) return;
    }
    setBusy(cat.id);
    setError("");
    try {
      await saveCategory(next);
      await onChanged();
      setNotice(`${next.name.trim()} saved`);
    } catch (e) {
      setError(e.message);
      setNames((n) => ({ ...n, [cat.id]: cat.name }));
    }
    setBusy("");
  }

  async function add() {
    let name = "New category";
    for (let i = 2; categories.some((c) => c.name.toLowerCase() === name.toLowerCase()); i++) name = `New category ${i}`;
    const p = PALETTE[(categories.length + 6) % PALETTE.length];
    const sortOrder = Math.max(0, ...categories.filter((c) => c.isSystem !== "other").map((c) => c.sortOrder)) + 1;
    setBusy("new");
    setError("");
    try {
      const created = await saveCategory({ name, color: p.color, textColor: p.textColor }, sortOrder);
      setNames((n) => ({ ...n, [created.id]: created.name }));
      await onChanged();
      setNotice(`${name} added. Rename it below.`);
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  }

  async function remove(cat) {
    setBusy(cat.id);
    setError("");
    try {
      const moved = await deleteCategory(cat.id);
      setConfirming("");
      await onChanged();
      setNotice(moved ? `${cat.name} deleted. ${moved} ${moved === 1 ? "event" : "events"} moved to ${otherName}.` : `${cat.name} deleted.`);
    } catch (e) {
      setError(e.message);
    }
    setBusy("");
  }

  return (
    <div className="gfc-modal-backdrop" onClick={onClose}>
      <div className="gfc-modal" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-label="Event categories" onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">Event categories</div>
          <button className="gfc-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 14px" }}>
          Rename, recolour, add or delete categories. Changes show in Club Management and the Player Portal straight away.
        </p>
        {error && <div className="cal-err" role="alert">{error}</div>}
        {notice && !error && <div className="cal-ok" role="status">{notice}</div>}
        {categories.map((c) => {
          const n = c.isSystem === "fixture" ? null : usage[c.id] || 0;
          return (
            <div key={c.id} className="cal-catrow">
              <div className="cal-catrow-top">
                <span className="cal-catpill" style={chipStyle(c)}>{names[c.id] || c.name}</span>
                <input
                  className="gfc-input"
                  style={{ flex: "1 1 180px", width: "auto" }}
                  aria-label={`Name of ${c.name}`}
                  value={names[c.id] ?? c.name}
                  maxLength={40}
                  disabled={busy === c.id}
                  onChange={(e) => setNames((x) => ({ ...x, [c.id]: e.target.value }))}
                  onBlur={(e) => save(c, { name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
                {n !== null && <span className="cal-tag">{n} {n === 1 ? "event" : "events"}</span>}
                {c.isSystem === "fixture" && <span className="cal-tag">Colours fixtures</span>}
                {c.isSystem === "other" && <span className="cal-tag">Built in</span>}
                {!c.isSystem && (
                  <button className="gfc-btn gfc-btn-ghost gfc-btn-sm" style={{ color: T.danger }} disabled={!!busy}
                    onClick={() => (n ? setConfirming(c.id) : remove(c))}>
                    Delete
                  </button>
                )}
              </div>
              <div className="cal-swatches" role="group" aria-label={`Colour for ${c.name}`}>
                {PALETTE.map((p) => (
                  <button key={p.color} type="button" aria-label={p.name} title={p.name} aria-pressed={p.color.toLowerCase() === c.color.toLowerCase()}
                    style={{ background: p.color }} disabled={busy === c.id}
                    onClick={() => save(c, { color: p.color, textColor: p.textColor })} />
                ))}
              </div>
              {confirming === c.id && (
                <div className="cal-err" style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span>{n === 1 ? `1 event uses ${c.name}. It'll move to ${otherName}.` : `${n} events use ${c.name}. They'll move to ${otherName}.`}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className="gfc-btn gfc-btn-ghost gfc-btn-sm" onClick={() => setConfirming("")}>Cancel</button>
                    <button className="gfc-btn gfc-btn-danger gfc-btn-sm" disabled={busy === c.id} onClick={() => remove(c)}>Delete category</button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <div className="gfc-modal-actions" style={{ justifyContent: "space-between" }}>
          <button className="gfc-btn gfc-btn-outline" onClick={add} disabled={!!busy}>+ Add category</button>
          <button className="gfc-btn gfc-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
