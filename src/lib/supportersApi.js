// ---------------------------------------------------------------------------
// Supporters: Supabase calls for Club Management -> Admin -> Supporters.
// Listing and decisions go through database functions that check the
// caller is an Admin, Chairman or Treasurer (migrations/2026-09-supporters.sql);
// removing an account goes through the manage-supporters Edge Function,
// because deleting a login needs the service-role key.
// ---------------------------------------------------------------------------

import { supabase } from "../supabaseClient";
import { fromDbSupporter, approvalEmail } from "./supporters.js";
import { extractFunctionErrorMessage } from "./errors.js";

export async function loadSupporters() {
  const [list, settings] = await Promise.all([
    supabase.rpc("list_supporters"),
    supabase.from("supporter_settings").select("require_approval").eq("id", 1).maybeSingle(),
  ]);
  if (list.error) throw list.error;
  if (settings.error) throw settings.error;
  return { supporters: (list.data || []).map(fromDbSupporter), requireApproval: settings.data ? !!settings.data.require_approval : true };
}

export async function setRequireApproval(value) {
  const { error } = await supabase.from("supporter_settings").update({ require_approval: value }).eq("id", 1);
  if (error) throw error;
}

export async function decideSupporter(id, status) {
  const { error } = await supabase.rpc("decide_supporter", { p_user: id, p_status: status });
  if (error) throw error;
}

/**
 * Emails an approved supporter that their account is ready. Returns an
 * error message, or null. A failed email doesn't undo the approval.
 */
export async function sendApprovalEmail(supporter, clubSettings, appUrl) {
  const { subject, html } = approvalEmail(supporter, appUrl, clubSettings?.senderDisplayName || "Garlandale FC");
  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: { to: supporter.email, subject, html, fromName: clubSettings?.senderDisplayName || "Garlandale FC", replyTo: clubSettings?.replyToEmail || undefined },
    });
    if (error || data?.error) return await extractFunctionErrorMessage(error, data);
    return null;
  } catch (e) {
    return e.message || "The email couldn’t be sent.";
  }
}

export async function removeSupporter(id) {
  const { data, error } = await supabase.functions.invoke("manage-supporters", { body: { action: "remove", userId: id } });
  if (error || data?.error) throw new Error(await extractFunctionErrorMessage(error, data));
}
