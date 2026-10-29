import { supabase } from "../supabaseClient.js";
import { generateStatementPDF } from "./statementPdf.js";
import { fmtMoney } from "./format.js";
import { extractFunctionErrorMessage } from "./errors.js";

export async function sendStatementEmail(player, clubSettings) {
  const to = player.email || "";
  if (!to) {
    return { error: "This player has no email address on file." };
  }
  const pdfBase64 = generateStatementPDF(player, clubSettings);
  const subject = `Garlandale FC - Subscription Statement for ${player.name}`;
  const html = `<p>Hi ${(player.name || "").split(" ")[0] || "there"},</p>
<p>Please find attached your latest Garlandale FC subscription statement.</p>
<p><strong>Current balance:</strong> ${fmtMoney(player.balance)}</p>
<p>Thank you for being part of Garlandale FC.</p>`;

  try {
    const { data, error } = await supabase.functions.invoke("send-email", {
      body: {
        to,
        subject,
        html,
        fromName: clubSettings?.senderDisplayName || "Garlandale FC",
        replyTo: clubSettings?.replyToEmail || undefined,
        pdfBase64,
        pdfFilename: `${player.name.replace(/\s+/g, "_")}_statement.pdf`,
      },
    });
    if (error || data?.error) {
      const msg = await extractFunctionErrorMessage(error, data);
      throw new Error(msg);
    }
    return { success: true };
  } catch (e) {
    return { error: e.message || "Failed to send email." };
  }
}
