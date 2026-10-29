import { createClient } from "@supabase/supabase-js";

// These come from your Supabase project settings -> API.
// Create a file called `.env` in your project root (never commit it) with:
//   VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-public-key
//
// The "anon" key is safe to use in browser code by design (it's the public
// key Supabase expects client apps to ship with) — it is NOT a secret admin
// key. Access control is enforced by the Row Level Security policies in
// schema.sql, not by hiding this key.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase env vars are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a .env file."
  );
}

// Capture the URL hash THE INSTANT this module loads, before Supabase's
// client below gets a chance to auto-process (and clear) any invite/
// recovery token in it. Without this, there's a timing race where the
// app can miss that this was a fresh invite link and skip straight to
// "logged in" without ever prompting the user to set a password.
export const initialUrlHash = typeof window !== "undefined" ? window.location.hash : "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
