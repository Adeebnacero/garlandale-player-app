// ---------------------------------------------------------------------------
// Supporters (Club Management -> Admin -> Supporters): rules with no
// database or screen code, tested in supporters.test.js.
//
// Supporters sign up in the Player Portal and confirm their email; only
// then are they really "waiting for approval". Unconfirmed sign-ups are
// shown separately so staff don't approve an address nobody has verified.
// ---------------------------------------------------------------------------

export function fromDbSupporter(row) {
  return {
    id: row.auth_user_id,
    name: row.full_name || "",
    phone: row.phone || "",
    email: row.email || "",
    status: row.status,
    follows: row.follows || [],
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    emailConfirmed: !!row.email_confirmed,
    lastSignInAt: row.last_sign_in_at,
  };
}

/** Splits the list into the groups shown on screen. */
export function groupSupporters(list) {
  return {
    waiting: list.filter((s) => s.status === "pending" && s.emailConfirmed),
    unconfirmed: list.filter((s) => s.status === "pending" && !s.emailConfirmed),
    approved: list.filter((s) => s.status === "approved"),
    declined: list.filter((s) => s.status === "declined"),
  };
}

/** Case-insensitive search on name and email; phone matches on digits. */
export function searchSupporters(list, q) {
  const text = String(q || "").trim().toLowerCase();
  if (!text) return list;
  const digits = text.replace(/\D/g, "");
  return list.filter((s) =>
    `${s.name} ${s.email}`.toLowerCase().includes(text) ||
    (digits.length >= 3 && s.phone.replace(/\D/g, "").includes(digits)));
}

export function supporterStats(list, now = new Date()) {
  const g = groupSupporters(list);
  const since = new Date(now.getTime() - 30 * 86400000);
  return {
    waiting: g.waiting.length,
    approved: g.approved.length,
    joinedRecently: g.approved.filter((s) => s.createdAt && new Date(s.createdAt) >= since).length,
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The "your account is ready" email sent when a supporter is approved. */
export function approvalEmail(supporter, appUrl, clubName = "Garlandale FC") {
  const first = escapeHtml((supporter.name || "").split(" ")[0] || "there");
  const link = appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open the ${escapeHtml(clubName)} app</a></p>` : "";
  return {
    subject: `Your ${clubName} supporter account is ready`,
    html: `<p>Hi ${first},</p>
<p>Your ${escapeHtml(clubName)} supporter account has been approved. Sign in with your email address and password to follow every team's fixtures, club news and the club shop.</p>
${link}
<p>Thank you for supporting the club!</p>`,
  };
}
