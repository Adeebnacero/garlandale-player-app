import React, { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { T, GLOBAL_CSS } from "../theme.js";
import BADGE_SRC from "../assets/badge.png";

// Same origin the invite-player Edge Function sends players to. Kept as a
// single constant here (rather than importing from App.jsx) to avoid a
// circular import; App.jsx uses the same literal when building the invite
// redirect URL.
const PLAYER_APP_URL = "https://www.gfcplayers.co.za/";

export function LoginView({ onLoggedIn }) {
  // Prefilled when arriving from the Player Portal's post-invite "where
  // would you like to go" chooser, so staff only have to type their password.
  const [email, setEmail] = useState(
    () => new URLSearchParams(window.location.search).get("email") || ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      onLoggedIn();
    } catch (e) {
      setError(e.message || "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: 360, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <img src={BADGE_SRC} alt="Garlandale FC crest" style={{ width: 64, height: 64, margin: "0 auto 10px" }} />
          <div className="gfc-display" style={{ color: T.indigo, fontSize: 20 }}>Garlandale FC</div>
          <div style={{ fontSize: 12, color: T.inkSoft }}>Club Management Login</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">Email</label>
            <input type="email" className="gfc-input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Password</label>
            <input type="password" className="gfc-input" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} />
          </div>
          {error && <div style={{ color: T.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
          <button type="submit" className="gfc-btn gfc-btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// After an invite link is accepted here, we don't actually know whether the
// person is a player (who belongs in the separate Player Portal app) or
// staff (who belongs in this app) - both kinds of invite can land here,
// e.g. if a player's link falls back to this app's Site URL instead of the
// Player Portal's. Rather than guessing, once the password is set we let
// the person pick where they want to go. Staff picking "Club Management"
// falls through to the normal role lookup below; anyone picking "Player
// Portal" is sent to that app's login screen (a fresh session is needed
// there anyway, since auth sessions don't cross origins).
export function AcceptInviteView({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [email, setEmail] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { data, error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setEmail(data?.user?.email || "");
      setPasswordSet(true);
    } catch (e) {
      setError(e.message || "Could not set password.");
    } finally {
      setBusy(false);
    }
  }

  function goToPlayerApp() {
    const url = new URL(PLAYER_APP_URL);
    if (email) url.searchParams.set("email", email);
    window.location.href = url.toString();
  }

  if (passwordSet) {
    return (
      <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <div style={{ width: 420, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14, padding: 32 }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <img src={BADGE_SRC} alt="Garlandale FC crest" style={{ width: 64, height: 64, margin: "0 auto 10px" }} />
            <div className="gfc-display" style={{ color: T.indigo, fontSize: 18 }}>Password set ✓</div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>Where would you like to go?</div>
          </div>

          <button
            className="gfc-btn gfc-btn-primary"
            style={{ width: "100%", justifyContent: "center", marginBottom: 12, padding: "14px 16px" }}
            onClick={goToPlayerApp}
          >
            ⚽ Player Portal
            <div style={{ fontWeight: 400, fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              Your fixtures, payments, notices &amp; profile
            </div>
          </button>

          <button
            className="gfc-btn gfc-btn-outline"
            style={{ width: "100%", justifyContent: "center", padding: "14px 16px" }}
            onClick={onDone}
          >
            🏟 Club Management
            <div style={{ fontWeight: 400, fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              Admin, treasurer &amp; coach tools
            </div>
          </button>

          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 18, textAlign: "center" }}>
            Not sure? If you're a player or a parent, choose Player Portal.
            Committee members and coaches should choose Club Management.
            You can always sign in to the other one separately later.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: 380, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <img src={BADGE_SRC} alt="Garlandale FC crest" style={{ width: 64, height: 64, margin: "0 auto 10px" }} />
          <div className="gfc-display" style={{ color: T.indigo, fontSize: 18 }}>Welcome to Garlandale FC</div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>Set a password to finish setting up your account</div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="gfc-field">
            <label className="gfc-label">New password</label>
            <input type="password" className="gfc-input" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </div>
          <div className="gfc-field">
            <label className="gfc-label">Confirm password</label>
            <input type="password" className="gfc-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <div style={{ color: T.danger, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
          <button type="submit" className="gfc-btn gfc-btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Saving…" : "Set password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function NoAccessView({ email, onLogout }) {
  function goToPlayerApp() {
    const url = new URL(PLAYER_APP_URL);
    if (email) url.searchParams.set("email", email);
    window.location.href = url.toString();
  }

  return (
    <div className="gfc-app" style={{ alignItems: "center", justifyContent: "center" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ width: 380, textAlign: "center", padding: 32 }}>
        <div className="gfc-display" style={{ color: T.danger, fontSize: 20, marginBottom: 10 }}>No access assigned</div>
        <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 20 }}>
          {email} is logged in, but doesn't have a role assigned in Garlandale FC's Club Management. Ask an Admin to invite this email address, or check with them if your access may have been removed.
        </div>
        <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 20 }}>
          Looking for the Player Portal instead? Your password has already been set, so you can sign in there directly.
        </div>
        <button className="gfc-btn gfc-btn-primary" style={{ marginBottom: 10, width: "100%", justifyContent: "center" }} onClick={goToPlayerApp}>
          Go to Player Portal
        </button>
        <button className="gfc-btn gfc-btn-outline" style={{ width: "100%", justifyContent: "center" }} onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
