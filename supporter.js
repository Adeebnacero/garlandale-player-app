// Supporter accounts in the Player Portal.
//
// A login is a GUARDIAN if it's linked to a player (everything works as
// before), or a SUPPORTER: someone who signed up themselves (signup.html).
// Supporters see every team's fixtures, notices and banners the club marks
// "Also show to supporters", and the shop. Until the club approves them,
// they only see the waiting screen on signup.html.
//
// Every page calls supporterGate() once after sign-in and branches on it.

import { cachedFetch, clearUserCache } from './cache.js';
import { escapeHtml } from './page-shared.js';
import { renderChangePassword } from './password.js';

/** { type: 'guardian' | 'supporter' | 'none', supporter?, clubEmail } */
export function loadAccount(SUPABASE_URL, accessToken, userId, { force = false } = {}) {
  return cachedFetch(userId, 'get-my-account', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-account`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not load your account');
    return json;
  }, { force });
}

/**
 * Works out which view a page should show. Returns
 * { supporter: false } for guardians (and if the check fails, so nothing
 * changes for them), { supporter: true, account } for approved supporters,
 * or { redirected: true } after sending a not-yet-approved supporter to the
 * waiting screen.
 */
export async function supporterGate(SUPABASE_URL, accessToken, userId) {
  let account;
  try { account = await loadAccount(SUPABASE_URL, accessToken, userId); } catch { return { supporter: false }; }
  if (!account || account.type !== 'supporter') return { supporter: false, account };
  if (account.supporter.status !== 'approved') {
    window.location.replace('signup.html?status=1');
    return { redirected: true };
  }
  hideGuardianOnly();
  return { supporter: true, account };
}

/** Removes links to screens that only apply to players (payments, loyalty). */
export function hideGuardianOnly() {
  document.querySelectorAll('a[href="payments.html"], a[href="loyalty.html"], #loyalty-nav-item, [data-loyalty-nav]')
    .forEach((el) => { el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); });
}

// ---------------------------------------------------------------------------
// Fixtures for supporters: every team
// ---------------------------------------------------------------------------
export const FIRST_TEAM = 'Seniors';

export function loadSupporterFixtures(SUPABASE_URL, accessToken, userId) {
  return cachedFetch(userId, 'get-my-fixtures:supporter', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-fixtures`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not load fixtures');
    return json;
  });
}

/** Team names in a sensible order: Seniors, Reserves, then oldest to youngest. */
export function orderTeams(teams) {
  const rank = (t) => {
    const s = String(t).toLowerCase();
    if (s === 'seniors') return [0, 0];
    if (s === 'reserves') return [1, 0];
    const m = s.match(/^u(\d+)/);
    return m ? [2, -Number(m[1])] : [3, 0];
  };
  return [...new Set(teams.filter(Boolean))].sort((a, b) => {
    const [ra, na] = rank(a), [rb, nb] = rank(b);
    return ra - rb || na - nb || String(a).localeCompare(String(b));
  });
}

const sameTeam = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The next match to feature: a followed team's, else the first team's, else the next of any. */
export function featuredFixture(fixtures, follows) {
  const list = fixtures || [];
  if (follows && follows.length) {
    const f = list.find((x) => follows.some((t) => sameTeam(t, x.age_group)));
    if (f) return f;
  }
  return list.find((x) => sameTeam(x.age_group, FIRST_TEAM)) || list[0] || null;
}

export function filterByTeam(fixtures, team, follows) {
  if (!team || team === 'all') return fixtures;
  if (team === 'following') return fixtures.filter((f) => (follows || []).some((t) => sameTeam(t, f.age_group)));
  return fixtures.filter((f) => sameTeam(f.age_group, team));
}

/** Filter chips: All teams, Following (if any), then each team. */
export function teamChipsHtml(teams, selected, follows) {
  const chips = [['all', 'All teams'], ...(follows && follows.length ? [['following', 'Following']] : []), ...teams.map((t) => [t, t])];
  return `<div class="team-chips" role="tablist" aria-label="Filter by team">${chips.map(([k, l]) =>
    `<button type="button" class="team-chip${selected === k ? ' on' : ''}" role="tab" aria-selected="${selected === k}" data-team="${escapeHtml(k)}">${escapeHtml(l)}</button>`).join('')}</div>`;
}

const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (t) => (t ? String(t).slice(0, 5) : '');

// ---------------------------------------------------------------------------
// Home for supporters
// ---------------------------------------------------------------------------
export async function startSupporterHome({ SUPABASE_URL, accessToken, uid, account, upcomingFixtures }) {
  const s = account.supporter;
  const nameEl = document.getElementById('player-name');
  if (nameEl) {
    nameEl.textContent = (s.fullName || 'Supporter').split(' ')[0];
    const h1 = nameEl.closest('h1');
    if (h1 && !document.getElementById('supporter-pill')) {
      h1.insertAdjacentHTML('afterend', '<span class="role-pill" id="supporter-pill">Supporter</span>');
    }
  }
  const childTabs = document.getElementById('child-tabs');
  if (childTabs) childTabs.style.display = 'none';
  const balanceCard = document.getElementById('balance-loading')?.closest('.card');
  if (balanceCard) balanceCard.style.display = 'none';

  const card = document.getElementById('fixture-card');
  const label = card?.querySelector('.card-label');
  const loadingEl = document.getElementById('fixture-loading');
  const noneEl = document.getElementById('fixture-none');
  const contentEl = document.getElementById('fixture-content');
  if (contentEl) contentEl.style.display = 'none';
  try {
    const body = await loadSupporterFixtures(SUPABASE_URL, accessToken, uid);
    const fixtures = upcomingFixtures(body.fixtures);
    const follows = s.follows || [];
    const featured = featuredFixture(fixtures, follows);
    const capLabel = document.querySelector('.stat-cap-label');
    const capValue = document.getElementById('hero-next-fixture');
    if (featured && capValue) {
      if (capLabel) capLabel.textContent = `Next match · ${featured.age_group || ''}`;
      capValue.textContent = `${dayLabel(featured.match_date)}${featured.kickoff_time ? ' · ' + timeLabel(featured.kickoff_time) : ''}`;
    }
    const list = (follows.length ? filterByTeam(fixtures, 'following', follows) : fixtures).slice(0, 3);
    if (loadingEl) loadingEl.style.display = 'none';
    if (label) label.textContent = follows.length ? 'Next fixtures for teams you follow' : 'Next fixtures';
    if (!list.length) {
      if (noneEl) { noneEl.textContent = 'No upcoming fixtures yet.'; noneEl.style.display = 'block'; }
      return;
    }
    let box = document.getElementById('supporter-fixtures');
    if (!box) { box = document.createElement('div'); box.id = 'supporter-fixtures'; card.appendChild(box); }
    box.innerHTML = list.map((f) => `
      <a class="mini-fixture" href="fixtures.html">
        <div><b>${escapeHtml(f.age_group || '')} vs ${escapeHtml(f.opponent || 'TBC')}</b><span>${escapeHtml(f.venue || 'Venue TBC')}${f.home_away ? ` · ${f.home_away === 'H' ? 'Home' : 'Away'}` : ''}</span></div>
        <div class="mini-fixture-when"><b>${escapeHtml(timeLabel(f.kickoff_time))}</b><span>${escapeHtml(dayLabel(f.match_date))}</span></div>
      </a>`).join('') + `<p class="mini-fixture-tip">${follows.length ? 'Change the teams you follow in Profile.' : 'Tip: choose teams to follow in Profile.'}</p>`;
  } catch {
    if (loadingEl) loadingEl.style.display = 'none';
    if (noneEl) { noneEl.textContent = 'Couldn’t load fixtures. Pull down or tap Refresh to try again.'; noneEl.style.display = 'block'; }
  }
}

// ---------------------------------------------------------------------------
// Profile for supporters
// ---------------------------------------------------------------------------
export async function startSupporterProfile({ SUPABASE_URL, accessToken, uid, account, supabase }) {
  const s = account.supporter;
  const main = document.querySelector('main');
  let teams = [];
  try { teams = orderTeams(((await loadSupporterFixtures(SUPABASE_URL, accessToken, uid)).fixtures || []).map((f) => f.age_group)); } catch { /* list stays short */ }
  teams = orderTeams([...teams, FIRST_TEAM, ...(s.follows || [])]);
  const follows = new Set(s.follows || []);

  main.innerHTML = `
    <p class="greeting">Your account</p>
    <h1>Profile</h1>
    <div class="card supporter-form">
      <p class="card-label">Your details</p>
      <label for="sp-name">Full name</label><input id="sp-name" autocomplete="name" maxlength="120" value="${escapeHtml(s.fullName || '')}">
      <label for="sp-phone">Cellphone</label><input id="sp-phone" inputmode="tel" autocomplete="tel" maxlength="16" value="${escapeHtml(s.phone || '')}">
      <label for="sp-email">Email</label><input id="sp-email" value="${escapeHtml(s.email || '')}" disabled>
      <p class="supporter-note">To change your email address, contact the club.</p>
    </div>
    <div class="card">
      <p class="card-label">Teams I follow</p>
      <p class="supporter-note" style="margin-top:-4px">Optional. Home shows these teams’ fixtures first, and Fixtures gets a “Following” filter.</p>
      <div class="follow-row">${teams.map((t) => `<label><input type="checkbox" data-follow="${escapeHtml(t)}" ${follows.has(t) ? 'checked' : ''}>${escapeHtml(t)}</label>`).join('')}</div>
    </div>
    <p class="login-error" id="sp-error" style="display:none"></p>
    <p class="supporter-saved" id="sp-saved" role="status" style="display:none">Saved.</p>
    <button type="button" class="supporter-primary" id="sp-save">Save changes</button>
    <div id="sp-password"></div>
    <div class="card" style="margin-top:22px">
      <p class="card-label">Account</p>
      <p class="supporter-note" style="margin-top:-4px">Deleting your account removes your login and details. Past shop orders are kept for the club’s records.</p>
      <button type="button" class="supporter-danger" id="sp-delete">Delete my account</button>
    </div>`;

  renderChangePassword(document.getElementById('sp-password'), supabase, s.email);

  const err = document.getElementById('sp-error');
  const saved = document.getElementById('sp-saved');
  const showErr = (m) => { err.textContent = m; err.style.display = 'block'; err.classList.add('visible'); saved.style.display = 'none'; };

  document.getElementById('sp-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    err.style.display = 'none';
    const full_name = document.getElementById('sp-name').value.trim();
    const phone = document.getElementById('sp-phone').value.trim();
    const chosen = [...main.querySelectorAll('[data-follow]')].filter((x) => x.checked).map((x) => x.dataset.follow);
    if (full_name.length < 2) return showErr('Enter your full name.');
    if (phone && !/^\+?[0-9 ]{9,16}$/.test(phone)) return showErr('Enter a valid cellphone number, or leave it empty.');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-my-supporter`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, phone, follows: chosen }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save your details.');
      await loadAccount(SUPABASE_URL, accessToken, uid, { force: true });
      saved.style.display = 'block';
    } catch (ex) {
      showErr(ex.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  });

  document.getElementById('sp-delete').addEventListener('click', async (e) => {
    if (!window.confirm('Delete your supporter account? This can’t be undone.')) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-my-account`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not delete your account.');
      clearUserCache(uid);
      try { await supabase.auth.signOut(); } catch { /* already gone */ }
      window.location.replace('index.html?deleted=1');
    } catch (ex) {
      showErr(ex.message);
      btn.disabled = false; btn.textContent = 'Delete my account';
    }
  });
}
