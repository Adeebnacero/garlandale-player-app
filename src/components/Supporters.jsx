import React, { useState, useEffect, useCallback, useMemo } from "react";
import { T } from "../theme.js";
import { fmtDate } from "../lib/format.js";
import { groupSupporters, searchSupporters, supporterStats } from "../lib/supporters.js";
import { loadSupporters, setRequireApproval, decideSupporter, sendApprovalEmail, removeSupporter } from "../lib/supportersApi.js";

// ---------------------------------------------------------------------------
// Admin -> Supporters. People who follow the club in the Player Portal
// without being linked to a player: they sign up themselves, confirm their
// email, and an Admin, Chairman or Treasurer approves them here.
// ---------------------------------------------------------------------------

const PLAYER_APP_URL = "https://www.gfcplayers.co.za";

const CSS = `
.sp-tabs { display: flex; gap: 4px; border-bottom: 2px solid ${T.line}; margin: 0 0 18px; flex-wrap: wrap; }
.sp-tab { background: none; border: 0; padding: 10px 16px; font: 700 13.5px 'Karla', sans-serif; color: ${T.inkSoft}; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.sp-tab.on { color: ${T.indigo}; border-bottom-color: ${T.gold}; }
.sp-tab:focus-visible { outline: 3px solid ${T.gold}; outline-offset: 2px; }
.sp-hint { font-size: 11.5px; color: ${T.inkSoft}; margin-top: 10px; line-height: 1.5; }
.sp-muted { color: ${T.inkSoft}; font-size: 11.5px; }
.sp-err { background: ${T.dangerSoft}; color: ${T.danger}; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
.sp-ok { background: ${T.greenSoft}; color: ${T.green}; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
.sp-check { display: flex; gap: 10px; align-items: center; font-size: 13px; cursor: pointer; }
.st-switch { position: relative; width: 38px; height: 22px; display: inline-block; flex: 0 0 auto; }
.st-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.st-switch span { position: absolute; inset: 0; background: #d9d1bd; border-radius: 999px; transition: background .15s; cursor: pointer; }
.st-switch span::after { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform .15s; }
.st-switch input:checked + span { background: ${T.green}; }
.st-switch input:checked + span::after { transform: translateX(16px); }
.st-switch input:focus-visible + span { outline: 3px solid ${T.gold}; outline-offset: 2px; }
.st-switch input:disabled + span { opacity: .5; cursor: wait; }
@media (prefers-reduced-motion: reduce) { .st-switch span, .st-switch span::after { transition: none; } }
`;

function Stat({ color, label, value }) {
  return (
    <div className="gfc-stat">
      <div className="gfc-stat-accent" style={{ background: color }} />
      <div className="gfc-stat-label">{label}</div>
      <div className="gfc-stat-value gfc-mono">{value}</div>
    </div>
  );
}

export function SupportersView({ clubSettings }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("waiting");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await loadSupporters());
      setError("");
    } catch (e) {
      setError(e.message || "Couldn’t load supporters.");
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const groups = useMemo(() => groupSupporters(data ? data.supporters : []), [data]);
  const stats = useMemo(() => supporterStats(data ? data.supporters : []), [data]);

  async function run(key, fn) {
    setBusy(key);
    setError("");
    setNotice("");
    try { await fn(); await reload(); } catch (e) { setError(e.message || "Something went wrong."); } finally { setBusy(""); }
  }

  const approve = (s) => run(s.id, async () => {
    await decideSupporter(s.id, "approved");
    const emailErr = await sendApprovalEmail(s, clubSettings, PLAYER_APP_URL);
    setNotice(emailErr
      ? `${s.name} is approved, but the email couldn’t be sent (${emailErr}). They can sign in now.`
      : `${s.name} is approved. We’ve emailed them that their account is ready.`);
  });
  const decline = (s) => {
    if (!window.confirm(`Decline ${s.name}? They’ll see a message asking them to contact the club.`)) return;
    run(s.id, async () => { await decideSupporter(s.id, "declined"); setNotice(`${s.name} was declined.`); });
  };
  const remove = (s) => {
    if (!window.confirm(`Remove ${s.name}? Their login will be deleted. Past shop orders are kept.`)) return;
    run(s.id, async () => { await removeSupporter(s.id); setNotice(`${s.name} was removed.`); });
  };
  const toggleApproval = (value) => run("setting", () => setRequireApproval(value));

  if (!data && !error) return <div><style>{CSS}</style><div className="gfc-empty">Loading supporters…</div></div>;

  const row = (s, actions) => (
    <tr key={s.id}>
      <td style={{ fontWeight: 600 }}>{s.name}</td>
      <td>{s.email}<div className="sp-muted">{s.phone || "No phone"}</div></td>
      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.createdAt)}</td>
      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>{actions}</td>
    </tr>
  );
  const table = (list, actions, empty) => list.length === 0 ? <div className="gfc-empty">{empty}</div> : (
    <div style={{ overflowX: "auto" }}>
      <table className="gfc-table">
        <thead><tr><th>Name</th><th>Contact</th><th>Signed up</th><th /></tr></thead>
        <tbody>{list.map((s) => row(s, actions(s)))}</tbody>
      </table>
    </div>
  );
  const btn = (s, label, onClick, cls = "gfc-btn-ghost", style) => (
    <button className={`gfc-btn ${cls} gfc-btn-sm`} style={style} disabled={!!busy} onClick={() => onClick(s)}>{busy === s.id ? "…" : label}</button>
  );

  const approvedList = searchSupporters(groups.approved, q);
  const tabs = [
    ["waiting", `Waiting for approval (${groups.waiting.length})`],
    ["approved", `Supporters (${groups.approved.length})`],
    ["declined", `Declined (${groups.declined.length})`],
  ];

  return (
    <div>
      <style>{CSS}</style>
      <div className="gfc-topbar">
        <div>
          <div className="gfc-page-title gfc-display">Supporters</div>
          <div className="gfc-page-sub">People who follow the club in the Player Portal without being linked to a player</div>
        </div>
      </div>
      {error && <div className="sp-err">{error} <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={reload}>Try again</button></div>}
      {notice && <div className="sp-ok" role="status">{notice}</div>}
      {data && (
        <>
          <div className="gfc-stat-row">
            <Stat color={T.amber} label="Waiting for approval" value={stats.waiting} />
            <Stat color={T.green} label="Approved supporters" value={stats.approved} />
            <Stat color={T.indigo} label="Joined in the last 30 days" value={stats.joinedRecently} />
          </div>
          <div className="sp-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} className={`sp-tab ${tab === id ? "on" : ""}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab === "waiting" && (
            <>
              <div className="gfc-panel">
                <div className="gfc-panel-head">
                  <div className="gfc-panel-title">Waiting for approval</div>
                  <label className="sp-check">
                    <span className="st-switch"><input type="checkbox" checked={data.requireApproval} disabled={busy === "setting"} onChange={(e) => toggleApproval(e.target.checked)} /><span /></span>
                    Require approval for new supporters
                  </label>
                </div>
                {table(groups.waiting, (s) => (<>
                  {btn(s, "Approve", approve, "gfc-btn-primary")}{" "}
                  {btn(s, "Decline", decline)}
                </>), "No one is waiting. New sign-ups appear here once they’ve confirmed their email.")}
              </div>
              {groups.unconfirmed.length > 0 && (
                <div className="sp-hint">
                  {groups.unconfirmed.length} more sign-up{groups.unconfirmed.length === 1 ? " hasn’t" : "s haven’t"} confirmed their email yet, so {groups.unconfirmed.length === 1 ? "isn’t" : "aren’t"} listed. They’ll appear here once they do.
                </div>
              )}
              <div className="sp-hint">
                Approving emails the supporter that their account is ready. Declining shows them a message asking them to email the club, and they can’t sign up again with the same email.
                {!data.requireApproval && " Approval is switched off: new supporters get in as soon as they confirm their email."}
              </div>
            </>
          )}

          {tab === "approved" && (
            <>
              <div className="gfc-panel">
                <div className="gfc-panel-head">
                  <div className="gfc-panel-title">Supporters</div>
                  <input className="gfc-input" style={{ width: 280, maxWidth: "100%" }} placeholder="Search name, email or phone" aria-label="Search supporters" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                {table(approvedList, (s) => btn(s, "Remove", remove, "gfc-btn-ghost", { color: T.danger }),
                  q ? "No supporters match that search." : "No approved supporters yet.")}
              </div>
              <div className="sp-hint">Removing a supporter deletes their login. Their past shop orders stay in Store → Orders.</div>
            </>
          )}

          {tab === "declined" && (
            <>
              <div className="gfc-panel">
                <div className="gfc-panel-head"><div className="gfc-panel-title">Declined</div></div>
                {table(groups.declined, (s) => (<>
                  {btn(s, "Approve after all", approve, "gfc-btn-outline")}{" "}
                  {btn(s, "Remove", remove, "gfc-btn-ghost", { color: T.danger })}
                </>), "No declined sign-ups.")}
              </div>
              <div className="sp-hint">If a declined supporter emails the club and you change your mind, approve them here. Removing deletes their login, which lets them sign up again from scratch.</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
