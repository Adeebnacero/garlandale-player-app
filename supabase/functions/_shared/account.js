// Supporter accounts, shared by the Player Portal's Edge Functions.
//
// A login is a GUARDIAN if it's linked to at least one player (these
// functions check that first, exactly as before). Otherwise it may be a
// SUPPORTER: someone who signed up themselves and whom the club approved
// (Club Management -> Admin -> Supporters). Anything else gets nothing.

const TEAM_RE = /^[A-Za-z0-9 +-]{1,20}$/;

/** The caller's supporter row if they're an APPROVED supporter, else null. */
export async function approvedSupporter(adminClient, userId) {
  const { data, error } = await adminClient
    .from("supporters")
    .select("auth_user_id, full_name, phone, email, status, follows")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error || !data || data.status !== "approved") return null;
  return data;
}

/**
 * Checks what a supporter sends to update their profile.
 * Returns { ok, row } or { ok: false, error }.
 */
export function parseSupporterUpdate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request." };
  const name = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Enter your full name." };
  if (phone && !/^\+?[0-9 ]{9,16}$/.test(phone)) return { ok: false, error: "Enter a valid cellphone number, or leave it empty." };
  const follows = Array.isArray(body.follows) ? body.follows : [];
  if (follows.length > 30 || follows.some((t) => typeof t !== "string" || !TEAM_RE.test(t))) {
    return { ok: false, error: "Something in your teams list isn’t valid." };
  }
  return { ok: true, row: { full_name: name, phone, follows: [...new Set(follows)] } };
}

/** Notices a supporter may see: marked for supporters, and never birthdays. */
export function supporterNoticeFilter(notice) {
  return !!notice.show_to_supporters && notice.category !== "birthday";
}
