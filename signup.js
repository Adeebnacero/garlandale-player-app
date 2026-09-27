// Supporter sign-up (signup.html).
//
//   signup.html               -> sign-up form
//   signup.html?confirmed=1   -> opened from the "confirm your email" link
//   signup.html?status=1      -> waiting for approval / declined screens
//
// Supporters sign up with Supabase Auth (email + password). The sign-up
// data marks the new login as a supporter; the database creates their
// supporter record (pending approval) from it. Staff approve them in Club
// Management -> Admin -> Supporters.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { escapeHtml } from './page-shared.js';
import { loadAccount } from './supporter.js';
import { clearUserCache } from './cache.js';

const box = document.getElementById('signup-box');
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const params = new URLSearchParams(location.search);
const CREST = '<img src="images/crest.png" alt="" class="signup-crest" width="56" height="66">';
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const ICON_WAIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

let form = { name: '', email: '', phone: '', password: '', agreed: false };

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function showForm(errors = {}, topError = '') {
  box.innerHTML = `
    ${CREST}
    <h1 class="signup-title">Join as a supporter</h1>
    <p class="signup-sub">Follow every Garlandale FC team: fixtures, club news and the club shop.</p>
    ${topError ? `<div class="login-error visible">${topError}</div>` : ''}
    <form id="signup-form" novalidate>
      <label for="su-name">Full name</label>
      <input id="su-name" data-f="name" autocomplete="name" maxlength="120" value="${escapeHtml(form.name)}">
      ${errors.name ? `<p class="signup-err">${errors.name}</p>` : ''}
      <label for="su-email">Email</label>
      <input id="su-email" data-f="email" type="email" autocomplete="email" maxlength="200" value="${escapeHtml(form.email)}">
      ${errors.email ? `<p class="signup-err">${errors.email}</p>` : ''}
      <label for="su-phone">Cellphone</label>
      <input id="su-phone" data-f="phone" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="082 555 0142" value="${escapeHtml(form.phone)}">
      ${errors.phone ? `<p class="signup-err">${errors.phone}</p>` : ''}
      <label for="su-password">Choose a password</label>
      <input id="su-password" data-f="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" value="${escapeHtml(form.password)}">
      ${errors.password ? `<p class="signup-err">${errors.password}</p>` : ''}
      <label class="signup-consent"><input type="checkbox" data-f="agreed" ${form.agreed ? 'checked' : ''}>
        <span>I agree to the club storing my details to run my account, as set out in the <button type="button" class="signup-link" data-act="privacy">privacy notice</button>.</span></label>
      ${errors.agreed ? `<p class="signup-err">${errors.agreed}</p>` : ''}
      <button type="submit" id="signup-submit">Create account</button>
    </form>
    <p class="login-note signup-foot"><a href="index.html">Already have an account? Sign in</a></p>`;
  box.querySelector('#signup-form').addEventListener('submit', onSubmit);
  const first = box.querySelector('.signup-err');
  if (first) first.previousElementSibling?.focus?.();
}

function showCheckEmail(email, note = '') {
  box.innerHTML = `
    <div class="signup-icon mail">${ICON_MAIL}</div>
    <h1 class="signup-title">Check your email</h1>
    <p class="signup-sub">We’ve sent a link to <b>${escapeHtml(email)}</b>. Tap it to confirm your email address. It can take a minute or two; check your spam folder too.</p>
    ${note ? `<p class="signup-sub">${note}</p>` : ''}
    <button type="button" data-act="resend" data-email="${escapeHtml(email)}">Send the email again</button>
    <p class="login-note signup-foot"><a href="index.html">Back to sign in</a></p>`;
}

function showPending(account) {
  const first = escapeHtml((account.supporter.fullName || '').split(' ')[0] || 'there');
  box.innerHTML = `
    <div class="signup-icon wait">${ICON_WAIT}</div>
    <h1 class="signup-title">Almost there, ${first}</h1>
    <p class="signup-sub">Your email is confirmed. The club checks new supporter accounts before they’re activated, usually within a day or two. We’ll email you as soon as you’re in.</p>
    <button type="button" data-act="check">Check again</button>
    <button type="button" class="btn-outline signup-second" data-act="signout">Sign out</button>`;
}

function showDeclined(account) {
  const email = account.clubEmail;
  box.innerHTML = `
    <div class="signup-icon wait">${ICON_WAIT}</div>
    <h1 class="signup-title">Account not activated</h1>
    <p class="signup-sub">The club wasn’t able to activate this supporter account.
      ${email ? `To find out why, email the club at <a class="signup-mail" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>.` : 'To find out why, email the club.'}</p>
    <button type="button" class="btn-outline" data-act="signout">Sign out</button>`;
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------
function validate() {
  const e = {};
  if (form.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email address.';
  if (!/^\+?[0-9 ]{9,16}$/.test(form.phone.trim())) e.phone = 'Enter your cellphone number, e.g. 082 555 0142.';
  if (form.password.length < 8) e.password = 'Use at least 8 characters.';
  if (!form.agreed) e.agreed = 'Tick the box to agree to the privacy notice.';
  return e;
}

async function onSubmit(ev) {
  ev.preventDefault();
  const errors = validate();
  if (Object.keys(errors).length) { showForm(errors); return; }
  const btn = box.querySelector('#signup-submit');
  btn.disabled = true; btn.textContent = 'Creating your account…';
  const email = form.email.trim().toLowerCase();
  let result;
  try {
    result = await supabase.auth.signUp({
      email,
      password: form.password,
      options: {
        emailRedirectTo: `${location.origin}/signup.html?confirmed=1`,
        data: { account_type: 'supporter', full_name: form.name.trim(), phone: form.phone.trim(), privacy_accepted: true },
      },
    });
  } catch {
    showForm({}, 'Couldn’t reach the club’s server. Check your connection and try again.');
    return;
  }
  const { data, error } = result;
  if (error) {
    const msg = /already registered|already exists/i.test(error.message)
      ? 'An account with this email already exists. <a href="index.html">Sign in instead</a>.'
      : /password/i.test(error.message) ? escapeHtml(error.message) : 'Something went wrong. Please try again.';
    showForm({}, msg);
    return;
  }
  // Supabase doesn't reveal whether an email is already registered: it
  // returns a user with no identities instead of an error.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    showForm({}, 'An account with this email already exists. <a href="index.html">Sign in instead</a>, or email the club if you’re having trouble.');
    return;
  }
  form.password = '';
  if (data.session) { await showStatus(data.session); return; }  // email confirmation switched off
  showCheckEmail(email);
}

// ---------------------------------------------------------------------------
// Status (after confirming, or signed in but not approved)
// ---------------------------------------------------------------------------
async function showStatus(session, { force = false } = {}) {
  let account;
  try {
    account = await loadAccount(SUPABASE_URL, session.access_token, session.user.id, { force });
  } catch {
    box.innerHTML = `<p class="signup-sub">Couldn’t check your account. <button type="button" class="signup-link" data-act="check">Try again</button></p>`;
    return;
  }
  if (account.type === 'guardian') { location.replace('home.html'); return; }
  if (account.type !== 'supporter') {
    box.innerHTML = `<h1 class="signup-title">No supporter account</h1>
      <p class="signup-sub">This login isn’t set up as a supporter account.${account.clubEmail ? ` Email the club at <a class="signup-mail" href="mailto:${escapeHtml(account.clubEmail)}">${escapeHtml(account.clubEmail)}</a> for help.` : ''}</p>
      <button type="button" class="btn-outline" data-act="signout">Sign out</button>`;
    return;
  }
  const st = account.supporter.status;
  if (st === 'approved') { location.replace('home.html'); return; }
  if (st === 'declined') { showDeclined(account); return; }
  showPending(account);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
box.addEventListener('input', (e) => {
  const k = e.target.dataset.f;
  if (!k) return;
  form[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  const holder = e.target.closest('label.signup-consent') || e.target;
  const next = holder.nextElementSibling;
  if (next && next.classList.contains('signup-err')) next.remove();
});

const sheet = document.getElementById('privacy-sheet');
document.getElementById('privacy-close').addEventListener('click', () => { sheet.hidden = true; });
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.hidden = true; });

box.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'privacy') { sheet.hidden = false; document.getElementById('privacy-close').focus(); return; }
  if (act === 'resend') {
    t.disabled = true; t.textContent = 'Sending…';
    const { error } = await supabase.auth.resend({ type: 'signup', email: t.dataset.email, options: { emailRedirectTo: `${location.origin}/signup.html?confirmed=1` } });
    showCheckEmail(t.dataset.email, error ? 'Couldn’t send it again just now. Wait a minute and try again.' : 'Sent again.');
    return;
  }
  if (act === 'check') {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { location.replace('index.html'); return; }
    t.disabled = true; t.textContent = 'Checking…';
    await showStatus(data.session, { force: true });
    return;
  }
  if (act === 'signout') {
    const { data } = await supabase.auth.getSession();
    if (data.session) clearUserCache(data.session.user.id);
    await supabase.auth.signOut();
    location.replace('index.html');
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  const { data } = await supabase.auth.getSession();   // also picks up the confirmation link's sign-in
  if (data.session) {
    history.replaceState(null, '', 'signup.html?status=1');
    await showStatus(data.session, { force: true });
  } else if (params.get('confirmed')) {
    box.innerHTML = `<h1 class="signup-title">Email confirmed</h1><p class="signup-sub">Sign in to see how your account is getting on.</p><a class="signup-button" href="index.html">Sign in</a>`;
  } else {
    showForm();
  }
})();
