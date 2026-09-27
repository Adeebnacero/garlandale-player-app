// Passwords in the Player Portal.
//
//   - reset-password.html: "Forgot password?" - request a reset email, then
//     choose a new password from the link (see reset.js).
//   - Profile: "Change password" for anyone signed in (renderChangePassword).
//
// Guardians, adult players and supporters all sign in the same way, so the
// same rules apply to everyone.

export const MIN_PASSWORD = 8;

/** Returns an error message, or '' if the new password is acceptable. */
export function checkNewPassword(password, confirm) {
  if (!password || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password.length > 72) return 'Use 72 characters or fewer.';
  if (password !== confirm) return 'The two passwords don’t match.';
  return '';
}

/** Supabase error text, in plain words. */
export function friendlyPasswordError(message) {
  const m = String(message || '');
  if (/should be different|same as the old/i.test(m)) return 'Choose a password you haven’t used before.';
  if (/weak|pwned|too common|characters/i.test(m)) return 'That password is too easy to guess. Try a longer one.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Couldn’t reach the club’s server. Check your connection and try again.';
  return m || 'Something went wrong. Please try again.';
}

/**
 * Appends a "Change password" card to `container`. Checks the current
 * password (by signing in with it) before setting the new one.
 */
export function renderChangePassword(container, supabase, email) {
  if (!container || !email) return;
  const card = document.createElement('div');
  card.className = 'card password-card';
  card.innerHTML = `
    <p class="card-label">Change password</p>
    <form class="password-form" novalidate>
      <label for="pw-current">Current password</label>
      <input id="pw-current" type="password" autocomplete="current-password">
      <label for="pw-new">New password</label>
      <input id="pw-new" type="password" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD} characters">
      <label for="pw-new2">New password again</label>
      <input id="pw-new2" type="password" autocomplete="new-password">
      <p class="password-msg" role="status" hidden></p>
      <button type="submit" class="password-btn">Change password</button>
      <p class="password-hint">Forgotten your current password? <a href="reset-password.html">Reset it by email</a>.</p>
    </form>`;
  container.appendChild(card);
  const form = card.querySelector('form');
  const msg = card.querySelector('.password-msg');
  const say = (text, ok = false) => { msg.textContent = text; msg.hidden = false; msg.classList.toggle('ok', ok); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = card.querySelector('#pw-current').value;
    const next = card.querySelector('#pw-new').value;
    const next2 = card.querySelector('#pw-new2').value;
    if (!current) { say('Enter your current password.'); return; }
    const problem = checkNewPassword(next, next2);
    if (problem) { say(problem); return; }
    const btn = card.querySelector('.password-btn');
    btn.disabled = true; btn.textContent = 'Changing…';
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (signInErr) { say(/invalid login/i.test(signInErr.message) ? 'Your current password isn’t right.' : friendlyPasswordError(signInErr.message)); return; }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) { say(friendlyPasswordError(error.message)); return; }
      form.reset();
      say('Password changed.', true);
    } catch (err) {
      say(friendlyPasswordError(err && err.message));
    } finally {
      btn.disabled = false; btn.textContent = 'Change password';
    }
  });
}
