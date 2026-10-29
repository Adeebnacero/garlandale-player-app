// supabase/functions/get-club-calendar/index.ts
//
// Player-facing endpoint: the Club calendar - club events and every
// Garlandale FC fixture - between two dates.
//
//   GET /get-club-calendar?from=2026-01-01&to=2026-12-31
//     -> { from, to, categories: [...], items: [...] }
//
// from/to are optional (default: this year) and may be at most 400 days
// apart. Every guardian and every approved supporter sees the same
// calendar; nothing here is per child. Events are added in Club
// Management -> Calendar; fixtures come from the Fixtures tab, plus
// Matchday entries that weren't created from a fixture (friendlies and
// other one-offs). Read with the service-role key, since the calendar
// tables are only readable by staff directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { saDate } from "../_shared/dates.js";
import { approvedSupporter } from "../_shared/account.js";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { parseRange, shapeCategory, shapeEvent, shapeFixture, shapeMatch, sortCalendarItems } from "../_shared/calendar.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

  // Guardians (linked to at least one player) and approved supporters only.
  const { data: playerIds, error: rpcErr } = await callerClient.rpc("current_player_ids");
  const isGuardian = !rpcErr && !!playerIds && playerIds.length > 0;
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!isGuardian && !(await approvedSupporter(adminClient, userData.user.id))) {
    return json({ error: "Your account isn't linked to the club yet." }, 403);
  }

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-club-calendar", { maxRequests: 60, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"), saDate());
  if (!range.ok) return json({ error: range.error }, 400);
  const { from, to } = range;

  const [catsRes, eventsRes, fixturesRes, matchesRes] = await Promise.all([
    adminClient.from("calendar_categories")
      .select("id, name, color, text_color, sort_order, is_system")
      .order("sort_order").order("name"),
    adminClient.from("calendar_events")
      .select("id, category_id, title, event_date, all_day, start_time, end_time, venue, description, location_link, location_embed, series_id, repeat_rule, repeat_until")
      .gte("event_date", from).lte("event_date", to)
      .order("event_date").limit(2000),
    adminClient.from("fixtures")
      .select("id, team_label, squad_age_group, opponent, match_date, kickoff_time, venue, home_away, location_link, location_embed")
      .gte("match_date", from).lte("match_date", to)
      .order("match_date").limit(2000),
    adminClient.from("matches")
      .select("id, opponent, home_away, venue, match_date, kickoff_time, competition, age_group, location_link, location_embed")
      .is("fixture_id", null)
      .gte("match_date", from).lte("match_date", to)
      .order("match_date").limit(1000),
  ]);

  const failed = catsRes.error || eventsRes.error || fixturesRes.error || matchesRes.error;
  if (failed) {
    console.error("get-club-calendar: load failed", failed);
    return json({ error: "Could not load the calendar - please try again." }, 500);
  }

  const items = sortCalendarItems([
    ...(eventsRes.data ?? []).map(shapeEvent),
    ...(fixturesRes.data ?? []).map(shapeFixture),
    ...(matchesRes.data ?? []).map(shapeMatch),
  ]);

  return json({ from, to, categories: (catsRes.data ?? []).map(shapeCategory), items });
});
