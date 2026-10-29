import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { T } from "../theme.js";
import { fmtDate } from "../lib/format.js";
import {
  BUTTON_KINDS, blankBanner, validateBanner, bannerStatus, daysLeft, buttonText, todaySA,
  friendlyBannerError, MAX_TITLE, MAX_MESSAGE, MAX_LABEL,
} from "../lib/banners.js";
import { loadBanners, saveBanner, deleteBanner, bannerPhotoUrl, uploadBannerPhoto, removeBannerPhoto } from "../lib/bannersApi.js";
import { preparePhoto } from "../lib/storeApi.js";
import { PHOTO_MAX_INPUT_BYTES } from "../lib/store.js";
import { AgeGroupPicker } from "./shared.jsx";
import { audienceLabel, sortGroups } from "../lib/audience.js";

// ---------------------------------------------------------------------------
// Messages -> Home banners. One banner at a time shows at the top of the
// Player Portal's Home screen: the newest one currently running for that
// guardian's child. Admin, Chairman and Treasurer can post for everyone;
// coaches only for their own teams, and can only change their own banners.
// ---------------------------------------------------------------------------

const CSS = `
.hb-banner { position: relative; background: linear-gradient(135deg, #241a45 0%, #342763 100%); color: #f7f5ef; border-radius: 18px; padding: 16px 16px 14px; overflow: hidden; font-family: 'Karla', sans-serif; max-width: 360px; }
.hb-banner::after { content: ""; position: absolute; right: -40px; top: -40px; width: 140px; height: 140px; border-radius: 50%; background: rgba(232, 172, 46, .14); }
.hb-pill { display: inline-block; background: #e8ac2e; color: #241a45; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 3px 9px; margin-bottom: 8px; }
.hb-banner h2 { font-family: 'Anton', sans-serif; text-transform: uppercase; font-size: 21px; line-height: 1.1; margin: 0 0 4px; font-weight: 400; overflow-wrap: anywhere; }
.hb-banner p { margin: 0 0 12px; font-size: 13.5px; line-height: 1.45; opacity: .9; white-space: pre-wrap; overflow-wrap: anywhere; }
.hb-photo { margin: -2px 0 12px; border-radius: 12px; background: rgba(255,255,255,.08); overflow: hidden; position: relative; z-index: 1; }
.hb-photo img { display: block; width: 100%; max-height: 180px; object-fit: contain; }
.hb-strip { display: flex; gap: 8px; margin-bottom: 14px; position: relative; z-index: 1; }
.hb-strip span { width: 64px; height: 64px; border-radius: 12px; background: #fff; display: flex; align-items: center; justify-content: center; color: #b8b09a; font-size: 10px; }
.hb-btn { display: inline-flex; align-items: center; gap: 6px; background: #e8ac2e; color: #241a45; border-radius: 12px; padding: 11px 16px; font: 700 14px 'Karla', sans-serif; position: relative; z-index: 1; }
.hb-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
@media (max-width: 1000px) { .hb-grid { grid-template-columns: 1fr; } }
.hb-err { color: ${T.danger}; font-size: 12px; font-weight: 700; margin-top: 4px; }
.hb-hint { font-size: 11.5px; color: ${T.inkSoft}; margin-top: 4px; }
.hb-count { font-size: 11px; color: ${T.inkSoft}; text-align: right; margin-top: 2px; }
.hb-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; margin: 8px 0; cursor: pointer; }
.hb-check input { margin-top: 2px; accent-color: ${T.indigo}; }
.hb-photo-box { border: 2px dashed #d9d1bd; border-radius: 10px; padding: 10px 12px; display: flex; gap: 12px; align-items: center; background: #faf8f2; margin-bottom: 14px; }
.hb-photo-box img { width: 72px; height: 48px; object-fit: contain; background: #fff; border-radius: 6px; }
.hb-banner-err { background: ${T.dangerSoft}; color: ${T.danger}; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
.hb-info { background: #ecebf8; color: #3b2f86; border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
tr.hb-row { cursor: pointer; }
tr.hb-row:hover td { background: ${T.paperDim}; }
tr.hb-row:focus-visible { outline: 3px solid ${T.gold}; outline-offset: -3px; }
`;

const STATUS_BADGE = {
  live: ["gfc-badge gfc-badge-green", "Showing"],
  scheduled: ["gfc-badge gfc-badge-neutral", "Scheduled"],
  ended: ["gfc-badge gfc-badge-neutral", "Ended"],
};

export function BannerPreview({ banner, photoUrl }) {
  const label = buttonText(banner);
  return (
    <div className="hb-banner" aria-label="Banner preview">
      <span className="hb-pill">New</span>
      <h2>{banner.title || "Your heading"}</h2>
      {banner.message && <p>{banner.message}</p>}
      {photoUrl && <div className="hb-photo"><img src={photoUrl} alt="" /></div>}
      {banner.buttonKind === "shop" && banner.showProductStrip && (
        <div className="hb-strip" aria-hidden="true"><span>Product</span><span>Product</span><span>Product</span></div>
      )}
      {label && <span className="hb-btn">{label} <span aria-hidden="true">›</span></span>}
    </div>
  );
}

export function HomeBannersSection({ role, staffId, staffTeams, ageGroups }) {
  const canTargetAll = role === "admin" || role === "treasurer";
  const myTeams = useMemo(() => (staffTeams || []).filter((t) => t.staffId === staffId).map((t) => t.ageGroup), [staffTeams, staffId]);
  const [banners, setBanners] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // banner | "new" | null
  const today = todaySA();

  const reload = useCallback(async () => {
    try {
      setBanners(await loadBanners());
      setError("");
    } catch (e) {
      setError(friendlyBannerError(e));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const canEdit = (b) => canTargetAll || b.postedBy === staffId;
  const liveNow = (banners || []).filter((b) => bannerStatus(b, today) === "live");

  return (
    <div>
      <style>{CSS}</style>
      <div className="hb-info">
        One banner shows at a time at the top of the Player Portal’s Home screen: the newest one currently running for
        that guardian’s child. Guardians can dismiss it with ×. It appears and disappears on its dates automatically.
        {!canTargetAll && " You can post banners for your own teams."}
      </div>
      {error && <div className="hb-banner-err">{error} <button className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={reload}>Try again</button></div>}
      <div className="gfc-panel">
        <div className="gfc-panel-head">
          <div className="gfc-panel-title">Home banners{banners ? ` (${banners.length})` : ""}</div>
          <button className="gfc-btn gfc-btn-primary gfc-btn-sm" onClick={() => setEditing("new")} disabled={!canTargetAll && myTeams.length === 0}>+ Add banner</button>
        </div>
        {!canTargetAll && myTeams.length === 0 && (
          <div className="hb-hint" style={{ padding: "0 16px 12px" }}>You don’t have any teams assigned yet. An Admin can assign them under Users.</div>
        )}
        {!banners ? (
          <div className="gfc-empty">Loading banners…</div>
        ) : banners.length === 0 ? (
          <div className="gfc-empty"><div className="gfc-empty-title gfc-display">No banners yet</div>Add one to highlight an event, the shop or anything important.</div>
        ) : (
          <div className="gfc-scroll-wrap" style={{ overflowX: "auto" }}>
            <table className="gfc-table">
              <thead><tr><th>Status</th><th>Heading</th><th>Dates</th><th>Who sees it</th><th>Button</th><th>Posted by</th></tr></thead>
              <tbody>
                {banners.map((b) => {
                  const st = bannerStatus(b, today);
                  const editable = canEdit(b);
                  return (
                    <tr key={b.id} className="hb-row" tabIndex={0} onClick={() => setEditing(b)} onKeyDown={(e) => { if (e.key === "Enter") setEditing(b); }}>
                      <td><span className={STATUS_BADGE[st][0]}>{STATUS_BADGE[st][1]}</span>{st === "live" && <div className="hb-hint">{daysLeft(b, today)} day{daysLeft(b, today) === 1 ? "" : "s"} left</div>}</td>
                      <td style={{ fontWeight: 600 }}>{b.title}{!editable && <div className="hb-hint">View only</div>}</td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{fmtDate(b.startsOn)} – {fmtDate(b.endsOn)}</td>
                      <td>{audienceLabel(b.targetAgeGroups)}{b.showToSupporters && <div className="hb-hint">+ supporters</div>}</td>
                      <td style={{ fontSize: 12.5 }}>{buttonText(b) || "—"}{b.markShopNew && <div className="hb-hint">+ “New” on Shop tab</div>}</td>
                      <td style={{ fontSize: 12 }}>{b.postedByEmail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {liveNow.length > 1 && (
        <div className="hb-hint" style={{ marginTop: 10 }}>
          {liveNow.length} banners are running now. Each guardian sees the newest one for their child; when they dismiss it, the next one shows.
        </div>
      )}

      {editing && (
        <BannerModal
          banner={editing === "new" ? null : editing}
          readOnly={editing !== "new" && !canEdit(editing)}
          canTargetAll={canTargetAll}
          myTeams={myTeams}
          ageGroups={ageGroups}
          staffId={staffId}
          today={today}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await reload(); }}
        />
      )}
    </div>
  );
}

function BannerModal({ banner, readOnly, canTargetAll, myTeams, ageGroups, staffId, today, onClose, onDone }) {
  const initial = useMemo(() => banner ? { ...banner } : blankBanner(today, canTargetAll ? [] : myTeams.length === 1 ? [myTeams[0]] : []), [banner, today, canTargetAll, myTeams]);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.previewUrl); }, [photo]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || !!photo || photoRemoved;
  const update = (field, value) => { setForm((f) => ({ ...f, [field]: value })); setErrors((e) => ({ ...e, [field === "locationLink" ? "location" : field]: "" })); setSaveError(""); };
  const targetOptions = canTargetAll ? (ageGroups || []).filter((g) => g !== "All") : myTeams;
  const currentPhoto = photo ? photo.previewUrl : photoRemoved ? "" : bannerPhotoUrl(form.photoPath);

  function requestClose() {
    if (busy) return;
    if (!readOnly && dirty && !window.confirm("Discard your changes to this banner?")) return;
    onClose();
  }

  async function choosePhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) { setSaveError("Choose a photo (JPG, PNG or WebP)."); return; }
    if (file.size > PHOTO_MAX_INPUT_BYTES) { setSaveError("That photo is over 15 MB. Choose a smaller one."); return; }
    try { setPhoto(await preparePhoto(file)); setPhotoRemoved(false); } catch (err) { setSaveError(err.message); }
  }

  async function handleSave() {
    const result = validateBanner(form, { canTargetAll, allowedGroups: myTeams });
    setErrors(result.errors);
    if (!result.ok) { setSaveError("Check the highlighted fields."); return; }
    setBusy(true);
    setSaveError("");
    const isNew = !banner;
    const id = banner ? banner.id : crypto.randomUUID();
    const oldPath = banner?.photoPath || "";
    let uploaded = "";
    try {
      if (photo) uploaded = await uploadBannerPhoto(id, photo.blob);
      const finalPath = uploaded || (photoRemoved ? "" : oldPath);
      await saveBanner(id, isNew, { ...result.row, photo_path: finalPath || null }, staffId);
      if (oldPath && oldPath !== finalPath) await removeBannerPhoto(oldPath);
      await onDone();
    } catch (err) {
      if (uploaded) await removeBannerPhoto(uploaded);
      setSaveError(friendlyBannerError(err));
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the banner “${banner.title}”? Guardians will stop seeing it straight away.`)) return;
    setBusy(true);
    try { await deleteBanner(banner); await onDone(); } catch (err) { setSaveError(friendlyBannerError(err)); setBusy(false); }
  }

  const kind = form.buttonKind;
  return (
    <div className="gfc-modal-backdrop" onClick={requestClose}>
      <div className="gfc-modal" style={{ maxWidth: 900 }} role="dialog" aria-modal="true" aria-label={banner ? "Edit banner" : "Add banner"} onClick={(e) => e.stopPropagation()}>
        <div className="gfc-modal-head">
          <div className="gfc-modal-title gfc-display">{readOnly ? "Banner" : banner ? "Edit banner" : "Add banner"}</div>
          <button className="gfc-modal-close" onClick={requestClose} aria-label="Close">×</button>
        </div>
        {readOnly && <div className="hb-info">This banner was posted by {banner.postedByEmail || "someone else"}. You can view it but not change it.</div>}
        <div className="hb-grid">
          <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="hb-title">Heading</label>
              <input className="gfc-input" id="hb-title" maxLength={MAX_TITLE} value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Prize-giving this Saturday" />
              {errors.title ? <div className="hb-err">{errors.title}</div> : <div className="hb-count">{form.title.length}/{MAX_TITLE}</div>}
            </div>
            <div className="gfc-field">
              <label className="gfc-label" htmlFor="hb-msg">Message</label>
              <textarea className="gfc-textarea" id="hb-msg" rows={3} maxLength={MAX_MESSAGE} value={form.message} onChange={(e) => update("message", e.target.value)} placeholder="e.g. 29 November, 14:00 at the clubhouse. Everyone welcome!" />
              {errors.message ? <div className="hb-err">{errors.message}</div> : <div className="hb-count">{form.message.length}/{MAX_MESSAGE}</div>}
            </div>

            <div className="hb-photo-box">
              {currentPhoto ? <img src={currentPhoto} alt="" /> : <span className="hb-hint" style={{ margin: 0 }}>No photo</span>}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Photo (optional)</div>
                <div className="hb-hint" style={{ margin: "2px 0 6px" }}>A poster or event photo. Shown whole, never cropped.</div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} hidden />
                <button type="button" className="gfc-btn gfc-btn-outline gfc-btn-sm" onClick={() => fileRef.current && fileRef.current.click()}>{currentPhoto ? "Replace photo" : "Upload photo"}</button>
                {currentPhoto && <button type="button" className="gfc-btn gfc-btn-ghost gfc-btn-sm" style={{ marginLeft: 6 }} onClick={() => { setPhoto(null); setPhotoRemoved(true); }}>Remove</button>}
              </div>
            </div>

            <div className="gfc-field">
              <label className="gfc-label" htmlFor="hb-kind">Button</label>
              <select className="gfc-select" id="hb-kind" value={kind} onChange={(e) => update("buttonKind", e.target.value)}>
                {BUTTON_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            {kind === "link" && (
              <div className="gfc-row2">
                <div className="gfc-field">
                  <label className="gfc-label" htmlFor="hb-url">Web address</label>
                  <input className="gfc-input" id="hb-url" value={form.linkUrl} onChange={(e) => update("linkUrl", e.target.value)} placeholder="https://forms.gle/..." />
                  {errors.link ? <div className="hb-err">{errors.link}</div> : <div className="hb-hint">Opens in the phone’s browser.</div>}
                </div>
                <div className="gfc-field">
                  <label className="gfc-label" htmlFor="hb-label">Button text</label>
                  <input className="gfc-input" id="hb-label" maxLength={MAX_LABEL} value={form.buttonLabel} onChange={(e) => update("buttonLabel", e.target.value)} placeholder="e.g. Register now" />
                  {errors.label && <div className="hb-err">{errors.label}</div>}
                </div>
              </div>
            )}
            {kind === "directions" && (
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="hb-loc">Google Maps link to the venue</label>
                <input className="gfc-input" id="hb-loc" value={form.locationLink} onChange={(e) => update("locationLink", e.target.value)} placeholder="https://maps.app.goo.gl/..." />
                {errors.location ? <div className="hb-err">{errors.location}</div> : <div className="hb-hint">In Google Maps, find the exact spot, tap Share, then Copy link.</div>}
              </div>
            )}
            {kind === "notices" && <div className="hb-hint" style={{ marginTop: -8, marginBottom: 12 }}>Tip: post the full details as a notice too; the button opens the Notices screen.</div>}
            {kind === "shop" && (
              <div style={{ marginBottom: 12 }}>
                <label className="hb-check"><input type="checkbox" checked={form.showProductStrip} onChange={(e) => update("showProductStrip", e.target.checked)} /><span><b>Show product photos</b> <span className="hb-hint">(the first three products with photos)</span></span></label>
                <label className="hb-check"><input type="checkbox" checked={form.markShopNew} onChange={(e) => update("markShopNew", e.target.checked)} /><span><b>Also show “New” on the Shop tab</b> until this banner ends <span className="hb-hint">(it clears for each guardian once they’ve opened the shop)</span></span></label>
                <div className="hb-hint">Shop banners only show while the shop is open.</div>
              </div>
            )}

            <div className="gfc-row2">
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="hb-start">Show from</label>
                <input className="gfc-input" type="date" id="hb-start" value={form.startsOn} onChange={(e) => update("startsOn", e.target.value)} />
                {errors.starts && <div className="hb-err">{errors.starts}</div>}
              </div>
              <div className="gfc-field">
                <label className="gfc-label" htmlFor="hb-end">Until (inclusive)</label>
                <input className="gfc-input" type="date" id="hb-end" value={form.endsOn} onChange={(e) => update("endsOn", e.target.value)} />
                {errors.ends ? <div className="hb-err">{errors.ends}</div> : <div className="hb-hint">Up to 91 days. It disappears at midnight after this date.</div>}
              </div>
            </div>
            <AgeGroupPicker
              id="hb-target"
              value={form.targetAgeGroups || []}
              onChange={(v) => { setForm((f) => ({ ...f, targetAgeGroups: v })); setErrors((e) => ({ ...e, target: "" })); }}
              options={sortGroups(targetOptions)}
              allowEveryone={canTargetAll}
            />
            {errors.target && <div className="hb-err" style={{ marginTop: -8, marginBottom: 10 }}>{errors.target}</div>}
            <label className="hb-check">
              <input type="checkbox" checked={!!form.showToSupporters} onChange={(e) => update("showToSupporters", e.target.checked)} />
              <span><b>Also show to supporters</b> <span className="hb-hint">(fans without a player; they only see banners with this ticked)</span></span>
            </label>
          </fieldset>

          <div>
            <div className="gfc-label" style={{ marginBottom: 8 }}>How it looks on Home</div>
            <BannerPreview banner={form} photoUrl={currentPhoto} />
          </div>
        </div>

        {saveError && <div className="hb-banner-err" style={{ marginTop: 12, marginBottom: 0 }}>{saveError}</div>}
        <div className="gfc-modal-actions">
          {banner && !readOnly && <button className="gfc-btn gfc-btn-danger" style={{ marginRight: "auto" }} onClick={handleDelete} disabled={busy}>Delete</button>}
          <button className="gfc-btn gfc-btn-ghost" onClick={requestClose} disabled={busy}>{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && <button className="gfc-btn gfc-btn-primary" onClick={handleSave} disabled={busy}>{busy ? "Saving…" : banner ? "Save changes" : "Add banner"}</button>}
        </div>
      </div>
    </div>
  );
}
