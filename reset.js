// Password reset (reset-password.html).
//
// 1. "Forgot password?" on the sign-in page opens this page. The person
//    enters their email and Supabase emails them a reset link. We always
//    show the same message, so nobody can use this to find out who has an
//    account.
// 2. The link comes back here with a one-time sign-in; they choose a new
//    password and carry on into the app.
// 3. Expired or already-used links are explained, with a way to send a
//    new one.
//
// This also works for guardians who never accepted their invite (or whose
// invite expired): opening the reset link proves they own the email, the
// same test the invite relies on.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { escapeHtml } from './page-shared.js';
import { checkNewPassword, friendlyPasswordError, MIN_PASSWORD } from './password.js';

const box = document.getElementById('reset-box');
const CREST = '<img src="images/crest.png" alt="" class="signup-crest" width="56" height="66">';

// Read what the email link put in the address before Supabase tidies it up.
const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
const query = new URLSearchParams(location.search);
const linkError = hash.get('error_code') || hash.get('error') || query.get('error_code') || '';
const isRecoveryLink = hash.get('type') === 'recovery' || query.get('type') === 'recovery';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let recovering = isRecoveryLink;
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY' && !recovering) { recovering = true; showNewPassword(); }
});

function showRequest({ note = '', email = '' } = {}) {
  box.innerHTML = `
    ${CREST}
    <h1 class="signup-title">Forgot your password?</h1>
    <p class="signup-sub">Enter the email address you use for the app and we’ll send you a link to choose a new password.</p>
    ${note ? `<div class="login-error visible">${note}</div>` : ''}
    <form id="reset-request" novalidate style="text-align:left">
      <label for="rs-email">Email</label>
      <input id="rs-email" type="email" autocomplete="email" maxlength="200" value="${escapeHtml(email || query.get('email') || '')}">
      <p class="signup-err" id="rs-err" hidden></p>
      <button type="submit" id="rs-send">Send reset link</button>
    </form>
    <p class="login-note signup-foot"><a href="index.html">Back to sign in</a></p>`;
  box.querySelector('#reset-request').addEventListener('submit', onRequest);
}

function showSent(email) {
  box.innerHTML = `
    <div class="signup-icon mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div>
    <h1 class="signup-title">Check your email</h1>
    <p class="signup-sub">If there’s an account for <b>${escapeHtml(email)}</b>, we’ve sent it a link to choose a new password. The link works once, for about an hour. Check your spam folder too.</p>
    <p class="signup-sub">No email after a few minutes? You may have used a different address, or your account may be under a guardian’s email. Contact the club if you’re stuck.</p>
    <button type="button" class="btn-outline" id="rs-again">Send it again</button>
    <p class="login-note signup-foot"><a href="index.html">Back to sign in</a></p>`;
  box.querySelector('#rs-again').addEventListener('click', () => showRequest({ email }));
}

function showNewPassword(note = '') {
  box.innerHTML = `
    ${CREST}
    <h1 class="signup-title">Choose a new password</h1>
    <p class="signup-sub">Use at least ${MIN_PASSWORD} characters.</p>
    ${note ? `<div class="login-error visible">${note}</div>` : ''}
    <form id="reset-set" novalidate style="text-align:left">
      <label for="rs-pw">New password</label>
      <input id="rs-pw" type="password" autocomplete="new-password">
      <label for="rs-pw2">New password again</label>
      <input id="rs-pw2" type="password" autocomplete="new-password">
      <p class="signup-err" id="rs-err" hidden></p>
      <button type="submit" id="rs-save">Save new password</button>
    </form>`;
  box.querySelector('#reset-set').addEventListener('submit', onSetPassword);
  box.querySelector('#rs-pw').focus();
}

function showDone() {
  box.innerHTML = `
    <div class="signup-icon mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg></div>
    <h1 class="signup-title">Password changed</h1>
    <p class="signup-sub">You’re signed in with your new password.</p>
    <a class="install-btn" href="home.html">Continue to the app</a>`;
}

function fieldError(text) {
  const el = box.querySelector('#rs-err');
  el.textContent = text; el.hidden = !text;
}

async function onRequest(e) {
  e.preventDefault();
  const email = box.querySelector('#rs-email').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldError('Enter a valid email address.'); return; }
  const btn = box.querySelector('#rs-send');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password.html` });
    // Only rate limits and network problems are shown. Anything else looks
    // exactly like success, so this can't be used to test for accounts.
    if (error && /rate limit|too many|security purposes/i.test(error.message)) {
      btn.disabled = false; btn.textContent = 'Send reset link';
      fieldError('A reset link was sent very recently. Wait a minute or two, then try again.');
      return;
    }
  } catch {
    btn.disabled = false; btn.textContent = 'Send reset link';
    fieldError('Couldn’t reach the club’s server. Check your connection and try again.');
    return;
  }
  showSent(email);
}

async function onSetPassword(e) {
  e.preventDefault();
  const pw = box.querySelector('#rs-pw').value;
  const problem = checkNewPassword(pw, box.querySelector('#rs-pw2').value);
  if (problem) { fieldError(problem); return; }
  const btn = box.querySelector('#rs-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  let result;
  try {
    result = await supabase.auth.updateUser({ password: pw });
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Save new password';
    fieldError(friendlyPasswordError(err && err.message));
    return;
  }
  if (result.error) {
    if (/session|not authenticated|jwt/i.test(result.error.message)) {
      showRequest({ note: 'This reset link has expired or was already used. Send yourself a new one below.' });
      return;
    }
    btn.disabled = false; btn.textContent = 'Save new password';
    fieldError(friendlyPasswordError(result.error.message));
    return;
  }
  showDone();
}

(async () => {
  if (linkError) {
    history.replaceState(null, '', 'reset-password.html');
    showRequest({ note: 'That reset link has expired or was already used. Send yourself a new one below.' });
    return;
  }
  if (recovering) {
    const { data } = await supabase.auth.getSession();       // picks up the link's one-time sign-in
    history.replaceState(null, '', 'reset-password.html');
    if (data.session) { showNewPassword(); return; }
    showRequest({ note: 'That reset link has expired or was already used. Send yourself a new one below.' });
    return;
  }
  showRequest();
})();
