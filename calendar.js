// calendar.js - the Club calendar screen (calendar.html).
//
// Shows club events (added in Club Management -> Calendar) and every
// Garlandale FC fixture in a week, month or year view. Everyone signed in
// sees the same calendar. Data comes from the get-club-calendar Edge
// Function one year at a time, saved for up to an hour (see cache.js).

import { cachedFetch, saDate } from './cache.js';
import { escapeHtml, escapeAttr, locationButtonsHtml, locationMapBoxHtml, handleShowMapClick } from './page-shared.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FALLBACK = { name: 'Other', color: '#cfc8b4', text_color: '#1E1E1E' };
const FIXTURE_FALLBACK = { name: 'Fixture', color: '#241B4B', text_color: '#ffffff' };

// ---------- dates (YYYY-MM-DD strings, weeks start on Monday) ----------
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const mondayOf = (k) => addDays(k, -((parseKey(k).getDay() + 6) % 7));
const longDate = (k) => { const d = parseKey(k); return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const timeLabel = (it) => (it.all_day || !it.start ? 'All day' : it.end ? `${it.start} – ${it.end}` : it.start);

export function setupCalendar({ SUPABASE_URL, accessToken, userId, els }) {
  const today = saDate();
  const state = { view: 'month', cursor: today, selected: today, years: {}, categories: [], loading: new Set(), error: '', openId: null };
  let lastFocus = null;

  // ---------- data ----------
  async function ensureYears(keys) {
    const years = [...new Set(keys.map((k) => k.slice(0, 4)))].filter((y) => !state.years[y] && !state.loading.has(y));
    if (!years.length) return;
    years.forEach((y) => state.loading.add(y));
    render();
    await Promise.all(years.map(async (y) => {
      try {
        const body = await cachedFetch(userId, `get-club-calendar:${y}`, async () => {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/get-club-calendar?from=${y}-01-01&to=${y}-12-31`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Could not load the calendar');
          return json;
        });
        state.years[y] = body.items || [];
        if (body.categories && body.categories.length) state.categories = body.categories;
        state.error = '';
      } catch (err) {
        state.error = err.message || 'Could not load the calendar';
      } finally {
        state.loading.delete(y);
      }
    }));
    render();
  }

  function itemsOn(k) {
    return (state.years[k.slice(0, 4)] || []).filter((it) => it.date === k);
  }

  function catOf(it) {
    if (it.kind === 'fixture') return state.categories.find((c) => c.is_system === 'fixture') || FIXTURE_FALLBACK;
    return state.categories.find((c) => c.id === it.category_id) || state.categories.find((c) => c.is_system === 'other') || FALLBACK;
  }

  function findItem(id) {
    for (const list of Object.values(state.years)) {
      const hit = list.find((it) => it.id === id);
      if (hit) return hit;
    }
    return null;
  }

  // ---------- rendering ----------
  const badge = (c) => `<span class="cal-badge" style="background:${escapeAttr(c.color)};color:${escapeAttr(c.text_color)}">${escapeHtml(c.name)}</span>`;
  const bar = (c) => `<span class="cal-bar" style="background:${escapeAttr(c.color)}"></span>`;

  function eventCard(it, compact) {
    const c = catOf(it);
    return `<button type="button" class="cal-item${compact ? ' compact' : ''}" data-open="${escapeAttr(it.id)}">
      ${bar(c)}
      <span class="cal-item-text">
        ${compact ? '' : badge(c)}
        <span class="cal-item-title">${escapeHtml(it.title)}</span>
        <span class="cal-item-meta">${compact ? `${escapeHtml(c.name)} · ` : ''}${escapeHtml(timeLabel(it))}${it.venue ? ` · ${escapeHtml(it.venue)}` : ''}</span>
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
    </button>`;
  }

  function periodLabel() {
    const d = parseKey(state.cursor);
    if (state.view === 'year') return String(d.getFullYear());
    if (state.view === 'month') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const a = parseKey(mondayOf(state.cursor));
    const b = parseKey(addDays(mondayOf(state.cursor), 6));
    return `${a.getDate()} ${MON3[a.getMonth()]} – ${b.getDate()} ${MON3[b.getMonth()]}`;
  }

  function monthHtml() {
    const first = state.cursor.slice(0, 8) + '01';
    const month = parseKey(first).getMonth();
    const start = mondayOf(first);
    const daysInMonth = new Date(parseKey(first).getFullYear(), month + 1, 0).getDate();
    const cells = Math.ceil((((parseKey(first).getDay() + 6) % 7) + daysInMonth) / 7) * 7;
    let grid = '';
    for (let i = 0; i < cells; i++) {
      const k = addDays(start, i);
      const list = itemsOn(k);
      const seen = new Set();
      const dots = [];
      for (const it of list) {
        const c = catOf(it);
        if (seen.has(c.color) || dots.length >= 3) continue;
        seen.add(c.color);
        dots.push(`<span class="cal-dot" style="background:${escapeAttr(c.color)}"></span>`);
      }
      const cls = ['cal-day'];
      if (parseKey(k).getMonth() !== month) cls.push('out');
      if (k === today) cls.push('today');
      if (k === state.selected) cls.push('selected');
      const label = `${longDate(k)}, ${list.length ? `${list.length} ${list.length === 1 ? 'item' : 'items'}` : 'nothing on'}`;
      grid += `<button type="button" class="${cls.join(' ')}" data-day="${k}" aria-label="${escapeAttr(label)}" aria-pressed="${k === state.selected}">
        <span class="cal-day-num">${parseKey(k).getDate()}</span><span class="cal-dots">${dots.join('')}</span></button>`;
    }
    const selList = itemsOn(state.selected);
    return `<div class="card cal-month">
        <div class="cal-weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
        <div class="cal-grid">${grid}</div>
      </div>
      <h2 class="cal-day-heading">${escapeHtml(longDate(state.selected))}</h2>
      ${selList.length ? selList.map((it) => eventCard(it, false)).join('') : '<div class="cal-empty">Nothing on at the club this day.</div>'}`;
  }

  function weekHtml() {
    const mon = mondayOf(state.cursor);
    let html = '';
    for (let i = 0; i < 7; i++) {
      const k = addDays(mon, i);
      const d = parseKey(k);
      const list = itemsOn(k);
      html += `<section class="cal-wday" aria-label="${escapeAttr(longDate(k))}">
        <h2 class="cal-wday-head${k === today ? ' today' : ''}">${WEEK_LONG[i]} <span>${d.getDate()} ${MON3[d.getMonth()]}</span>${k === today ? '<span class="cal-today-tag">Today</span>' : ''}</h2>
        ${list.length ? list.map((it) => eventCard(it, true)).join('') : '<div class="cal-none">No events</div>'}
      </section>`;
    }
    return html;
  }

  function yearHtml() {
    const y = parseKey(state.cursor).getFullYear();
    let html = '<div class="cal-year">';
    for (let m = 0; m < 12; m++) {
      const first = `${y}-${pad(m + 1)}-01`;
      const lead = (parseKey(first).getDay() + 6) % 7;
      const days = new Date(y, m + 1, 0).getDate();
      let cells = '';
      let total = 0;
      for (let b = 0; b < lead; b++) cells += '<span class="blank"></span>';
      for (let day = 1; day <= days; day++) {
        const k = `${y}-${pad(m + 1)}-${pad(day)}`;
        const list = itemsOn(k);
        total += list.length;
        const pick = list.find((it) => it.kind === 'fixture') || list[0];
        const style = pick ? `background:${escapeAttr(catOf(pick).color)}` : '';
        cells += `<span class="${k === today ? 'today' : ''}" style="${style}"></span>`;
      }
      const isNow = first.slice(0, 7) === today.slice(0, 7);
      html += `<button type="button" class="cal-ymonth${isNow ? ' now' : ''}" data-month="${first}" aria-label="${escapeAttr(`${MONTHS[m]} ${y}, ${total} ${total === 1 ? 'item' : 'items'}`)}">
        <span class="cal-ymonth-head"><b>${MON3[m]}</b><span>${total || ''}</span></span>
        <span class="cal-ygrid" aria-hidden="true">${cells}</span></button>`;
    }
    html += '</div><div class="cal-legend">' + state.categories
      .map((c) => `<span><i style="background:${escapeAttr(c.color)}"></i>${escapeHtml(c.name)}</span>`).join('') + '</div>';
    return html;
  }

  function sheetHtml(it) {
    const c = catOf(it);
    const key = `sheet-${it.id}`;
    const row = (icon, text) => `<div class="cal-sheet-row">${icon}<span>${escapeHtml(text)}</span></div>`;
    const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
    const ICON_TIME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const ICON_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19" aria-hidden="true"><path d="M12 21s7-6.5 7-12a7 7 0 00-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>';
    const ICON_REPEAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="19" height="19" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/></svg>';
    const buttons = locationButtonsHtml(it, key);
    return `<div class="cal-sheet-card" role="dialog" aria-modal="true" aria-labelledby="cal-sheet-title">
      <span class="cal-sheet-handle" aria-hidden="true"></span>
      ${badge(c)}
      <h2 id="cal-sheet-title">${escapeHtml(it.title)}</h2>
      ${row(ICON_CAL, longDate(it.date))}
      ${row(ICON_TIME, timeLabel(it))}
      ${it.venue ? row(ICON_PIN, it.venue + (it.kind === 'fixture' && it.home_away ? (it.home_away === 'A' ? ' (Away)' : ' (Home)') : '')) : ''}
      ${it.repeat_text ? row(ICON_REPEAT, it.repeat_text) : ''}
      ${it.description ? `<p class="cal-sheet-desc">${escapeHtml(it.description)}</p>` : ''}
      ${buttons ? `<div class="fixture-actions">${buttons}</div>${locationMapBoxHtml(it, key)}` : ''}
      <button type="button" class="cal-sheet-close" data-close>Close</button>
    </div>`;
  }

  function render() {
    els.period.textContent = periodLabel();
    els.tabs.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    const loadingNow = state.loading.size > 0;
    els.status.innerHTML = state.error
      ? `<div class="login-error visible" role="alert">${escapeHtml(state.error)} <button type="button" class="cal-retry" data-retry>Try again</button></div>`
      : loadingNow ? '<div class="cal-loading"><span class="spinner-inline" aria-hidden="true"></span>Loading the calendar…</div>' : '';
    els.body.innerHTML = state.view === 'month' ? monthHtml() : state.view === 'week' ? weekHtml() : yearHtml();
  }

  function neededKeys() {
    if (state.view === 'week') return [mondayOf(state.cursor), addDays(mondayOf(state.cursor), 6)];
    if (state.view === 'month') { const first = state.cursor.slice(0, 8) + '01'; return [mondayOf(first), addDays(mondayOf(first), 41)]; }
    return [state.cursor];
  }

  function go() {
    render();
    ensureYears(neededKeys());
  }

  function shift(dir) {
    const d = parseKey(state.cursor);
    if (state.view === 'week') state.cursor = addDays(state.cursor, 7 * dir);
    else if (state.view === 'month') {
      state.cursor = toKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
      state.selected = state.cursor.slice(0, 7) === today.slice(0, 7) ? today : state.cursor;
    } else state.cursor = toKey(new Date(d.getFullYear() + dir, d.getMonth(), 1));
    go();
  }

  function openSheet(id) {
    const it = findItem(id);
    if (!it) return;
    lastFocus = document.activeElement;
    els.sheet.innerHTML = sheetHtml(it);
    els.sheet.hidden = false;
    document.body.classList.add('cal-sheet-open');
    const close = els.sheet.querySelector('[data-close]');
    if (close) close.focus();
  }

  function closeSheet() {
    els.sheet.hidden = true;
    els.sheet.innerHTML = '';
    document.body.classList.remove('cal-sheet-open');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------- events ----------
  els.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    go();
  });
  els.prev.addEventListener('click', () => shift(-1));
  els.next.addEventListener('click', () => shift(1));
  els.today.addEventListener('click', () => { state.cursor = today; state.selected = today; go(); });
  els.status.addEventListener('click', (e) => {
    if (!e.target.closest('[data-retry]')) return;
    state.error = '';
    go();
  });
  els.body.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { openSheet(open.dataset.open); return; }
    const day = e.target.closest('[data-day]');
    if (day) {
      const k = day.dataset.day;
      state.selected = k;
      if (k.slice(0, 7) !== state.cursor.slice(0, 7)) state.cursor = k.slice(0, 8) + '01';
      go();
      const again = els.body.querySelector(`[data-day="${k}"]`);
      if (again) again.focus();
      return;
    }
    const month = e.target.closest('[data-month]');
    if (month) {
      state.view = 'month';
      state.cursor = month.dataset.month;
      state.selected = state.cursor.slice(0, 7) === today.slice(0, 7) ? today : state.cursor;
      go();
    }
  });
  els.sheet.addEventListener('click', (e) => {
    if (handleShowMapClick(e, els.sheet)) return;
    if (e.target === els.sheet || e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.sheet.hidden) closeSheet();
  });

  go();
}
