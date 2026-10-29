// ---------------------------------------------------------------------------
// Home banners: reading and writing in Supabase, as the logged-in staff
// member. Row-level security decides who may post what (coaches only for
// their own age groups; see migrations/2026-09-chairman-and-home-banners.sql).
// Photos are shrunk with the same code as product photos (storeApi.js).
// ---------------------------------------------------------------------------

import { supabase } from "../supabaseClient";
import { fromDbBanner } from "./banners.js";
import { photoPath } from "./store.js";

export const BANNER_BUCKET = "banner-photos";

export async function loadBanners() {
  const { data, error } = await supabase
    .from("home_banners")
    .select("*")
    .order("starts_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map(fromDbBanner);
}

export function bannerPhotoUrl(path) {
  if (!path) return "";
  return supabase.storage.from(BANNER_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadBannerPhoto(bannerId, blob) {
  const path = photoPath(bannerId);
  const { error } = await supabase.storage.from(BANNER_BUCKET).upload(path, blob, {
    contentType: "image/jpeg", cacheControl: "31536000", upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removeBannerPhoto(path) {
  if (!path) return;
  try { await supabase.storage.from(BANNER_BUCKET).remove([path]); } catch { /* leftover file is harmless */ }
}

/** Creates (id given, isNew) or updates a banner. row comes from validateBanner(). */
export async function saveBanner(id, isNew, row, staffId) {
  if (isNew) {
    const { error } = await supabase.from("home_banners").insert({ id, ...row, posted_by: staffId });
    if (error) throw error;
    return;
  }
  // An update the database's rules don't allow changes nothing and reports
  // no error, so check that a row was actually updated.
  const { data, error } = await supabase.from("home_banners").update(row).eq("id", id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("You can only change banners you posted for your own teams.");
}

export async function deleteBanner(banner) {
  const { data, error } = await supabase.from("home_banners").delete().eq("id", banner.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("You can only delete banners you posted.");
  await removeBannerPhoto(banner.photoPath);
}
