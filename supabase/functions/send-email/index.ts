// Supabase Edge Function: send-email
//
// Sends an email through the club's Gmail account using SMTP on port 465
// (port 587 is blocked on Supabase Edge Functions - 465 works fine with
// Gmail). Credentials come from Edge Function secrets, never from the
// database, since anyone with the project's anon key can read the database
// but NOT these secrets.
//
// Required secrets (set once via the Supabase CLI):
//   supabase secrets set SMTP_USERNAME="yourclub@gmail.com"
//   supabase secrets set SMTP_PASSWORD="your-16-character-app-password"
//
// Deploy with:
//   supabase functions deploy send-email

import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Returns an error message unless the caller is logged in as a staff member.
async function requireStaff(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return "Not authenticated.";
  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await caller.auth.getUser();
  if (error || !userData?.user) return "Not authenticated.";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: staffRow } = await admin.from("staff").select("id").eq("user_id", userData.user.id).maybeSingle();
  return staffRow ? null : "Only club staff can send email.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Staff only. The app's public key is enough to reach this function, so
    // without this check anyone could send email from the club's account.
    const staffErr = await requireStaff(req);
    if (staffErr) {
      return new Response(JSON.stringify({ error: staffErr }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, subject, html, fromName, replyTo, pdfBase64, pdfFilename } = await req.json();

    if (!to || !subject) {
      return new Response(JSON.stringify({ error: "Missing 'to' or 'subject'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const username = Deno.env.get("SMTP_USERNAME");
    const password = Deno.env.get("SMTP_PASSWORD");

    if (!username || !password) {
      return new Response(JSON.stringify({ error: "Email is not configured on the server (missing SMTP secrets)." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username, password },
      },
    });

    const attachments = [];
    if (pdfBase64) {
      attachments.push({
        filename: pdfFilename || "statement.pdf",
        content: pdfBase64,
        encoding: "base64",
        contentType: "application/pdf",
      });
    }

    await client.send({
      from: fromName ? `${fromName} <${username}>` : username,
      to,
      replyTo: replyTo || undefined,
      subject,
      content: "Please see attached." ,
      html: html || "<p>Please see attached.</p>",
      attachments,
    });

    await client.close();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error sending email" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
