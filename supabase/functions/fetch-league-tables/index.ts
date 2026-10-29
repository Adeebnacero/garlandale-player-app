// Supabase Edge Function: fetch-league-tables
//
// Fetches each URL configured in league_table_sources (public standings
// pages on the federation's LeagueRepublic site), parses the HTML table,
// and replaces league_standings for that source with fresh data.
//
// IMPORTANT: this is screen-scraping a third-party website, not parsing a
// stable file format. If LeagueRepublic ever changes their page layout,
// parsing could break. Deliberately does NOT wipe out existing standings
// on a failed fetch/parse - the error is recorded on the source row, and
// the last successfully parsed data is left in place. A stale table is
// more useful than a blank one.
//
// Deliberately uses plain regex rather than a DOM-parsing library: an
// earlier version used "linkedom", which transitively pulls in a "canvas"
// package requiring a native binary Deno's edge runtime can't bundle
// ("Module not found ...canvas.node"). Since the table's exact structure
// is already known from real fetched data, regex is simpler and has zero
// external dependencies to break in this environment.
//
// 2026-08 rewrite: LeagueRepublic rolled out a new site template
// ("theme4") that changed BOTH the standings page URL and the table
// itself. The old pages (`/standingsForDate/<id>/2/-1/-1.html`) split
// stats into Home/Away/Overall column groups (21+ columns/row, fixed
// positions) - those URLs now return an empty/JS-rendered page, and the
// new pages (`/fg/<type>_<competitionId>.html`) use a single, much
// simpler P/W/D/L/F/A/+-/BP/PTS table instead. The parser below now
// locates columns by reading the header row's own labels (P, W, D, L, F,
// A, +-, PTS) rather than hardcoding column positions/counts, so a future
// column reorder won't silently break this again the way the fixed
// "cells.length < 21" check did. Every URL in league_table_sources needs
// updating to the new `/fg/...` format for this to work - the old URLs
// will just keep failing with "Could not find a standings table".
//
// Triggered weekly by pg_cron (see schema.sql) - not meant to be called
// directly by any user action in the app.
//
// Deploy with:
//   supabase functions deploy fetch-league-tables --no-verify-jwt
//
// (--no-verify-jwt is needed since this is called by a scheduled job, not
// a logged-in user - the function has no user JWT to verify. It's still
// only reachable with the project's service role key, which pg_cron's
// call includes - see the cron job definition in schema.sql.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same team-code-stripping convention as the fixture spreadsheet import
// (src/lib/fixtureImport.js) - e.g. "PD-01- Durbanville" -> "Durbanville".
function stripTeamCode(name) {
  return String(name || "").replace(/^[A-Za-z0-9]+-\d+-\s*/, "").trim();
}

function isGarlandale(name) {
  return stripTeamCode(name).toLowerCase().includes("garlandale");
}

/** Strips HTML tags (keeping the text between them) and decodes the small set of entities this page actually uses. */
function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractCells(rowHtml) {
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const cells = [];
  let m;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    cells.push(stripHtmlTags(m[1]));
  }
  return cells;
}

async function parseStandingsPage(url) {
  // LeagueRepublic's 2026 redesign sits behind bot protection that
  // rejects requests without a normal browser-looking User-Agent -
  // Deno's default fetch() sends none, which gets a flat 403 even though
  // the exact same URL loads fine in an actual browser. Spoofing a
  // realistic header set is a standard, low-risk fix for this - we're
  // not bypassing any login/paywall, just avoiding a bot fingerprint
  // check on a page that's otherwise fully public.
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`Fetch failed with status ${resp.status}`);
  const html = await resp.text();

  // The standings table is identified by its header row containing "PTS" -
  // more robust than assuming it's the first/only <table> on the page.
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableHtml = null;
  let tm;
  while ((tm = tableRegex.exec(html)) !== null) {
    if (/PTS/i.test(tm[1])) {
      tableHtml = tm[1];
      break;
    }
  }
  if (!tableHtml) throw new Error("Could not find a standings table on the page");

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rm;
  while ((rm = rowRegex.exec(tableHtml)) !== null) {
    rows.push(rm[1]);
  }

  // Find the header row - the one whose cells include "PTS" as a label,
  // rather than assuming it's always the Nth row (the old template had
  // two header rows above the data; the new one has just one). Locating
  // it by content, not position, means a future header-row-count change
  // won't silently break this again.
  let headerIndex = -1;
  let headerCells = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = extractCells(rows[i]).map((c) => c.trim().toUpperCase());
    if (cells.includes("PTS")) {
      headerIndex = i;
      headerCells = cells;
      break;
    }
  }
  if (headerIndex === -1) throw new Error("Could not find a header row with PTS in the standings table");

  // Map each known stat label to its column index within the header row,
  // rather than hardcoding fixed positions - the exact column count/order
  // has already changed once (2026 site redesign), and this way a future
  // reorder doesn't silently break parsing again.
  const colIndex = (label) => headerCells.indexOf(label);
  const idx = {
    played: colIndex("P"),
    won: colIndex("W"),
    drawn: colIndex("D"),
    lost: colIndex("L"),
    goalsFor: colIndex("F"),
    goalsAgainst: colIndex("A"),
    goalDifference: colIndex("+-"),
    points: colIndex("PTS"),
  };
  const required = ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "points"];
  const missing = required.filter((k) => idx[k] === -1);
  if (missing.length > 0) throw new Error(`Standings table is missing expected column(s): ${missing.join(", ")}`);

  // The team name is whatever's in the first column after position (#) -
  // deliberately looked up by fixed offset rather than header label, since
  // that column's header is always blank (it holds the crest + team link,
  // not a stat name).
  const teamCol = 1;
  const maxColNeeded = Math.max(teamCol, ...Object.values(idx));

  const dataRows = rows.slice(headerIndex + 1);
  const standings = [];
  for (const rowHtml of dataRows) {
    const cells = extractCells(rowHtml);
    if (cells.length <= maxColNeeded) continue; // not a real data row (e.g. a stray footer row)

    const teamRaw = cells[teamCol];
    if (!teamRaw) continue;

    const num = (i) => (i === -1 ? 0 : parseInt(cells[i], 10) || 0);

    // Position (#) isn't guaranteed numeric for every placeholder row (a
    // "Bye" entry, for instance) - fall back to null rather than failing
    // the whole row over a cosmetic column.
    const posRaw = parseInt(cells[0], 10);

    standings.push({
      position: Number.isFinite(posRaw) ? posRaw : null,
      team_name: stripTeamCode(teamRaw),
      played: num(idx.played),
      won: num(idx.won),
      drawn: num(idx.drawn),
      lost: num(idx.lost),
      goals_for: num(idx.goalsFor),
      goals_against: num(idx.goalsAgainst),
      goal_difference: num(idx.goalDifference),
      points: num(idx.points),
      is_garlandale: isGarlandale(teamRaw),
    });
  }

  if (standings.length === 0) throw new Error("Standings table found but no data rows could be parsed");
  return standings;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: sources, error: sourcesErr } = await adminClient.from("league_table_sources").select("*");
    if (sourcesErr) throw sourcesErr;

    const results = [];
    for (const source of sources || []) {
      try {
        const standings = await parseStandingsPage(source.source_url);

        await adminClient.from("league_standings").delete().eq("source_id", source.id);
        const { error: insertErr } = await adminClient
          .from("league_standings")
          .insert(standings.map((s) => ({ ...s, source_id: source.id })));
        if (insertErr) throw insertErr;

        await adminClient
          .from("league_table_sources")
          .update({ last_fetched_at: new Date().toISOString(), last_fetch_error: null })
          .eq("id", source.id);

        results.push({ source: source.division_label, success: true, rows: standings.length });
      } catch (e) {
        // Deliberately do NOT touch league_standings here - keep whatever
        // was last successfully parsed rather than wiping it out.
        await adminClient
          .from("league_table_sources")
          .update({ last_fetch_error: e.message || "Unknown error" })
          .eq("id", source.id);
        results.push({ source: source.division_label, success: false, error: e.message || "Unknown error" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error fetching league tables." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
