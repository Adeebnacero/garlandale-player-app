// supabase/functions/get-my-notices/index.ts
//
// Player-facing endpoint: returns the notice board, pinned items first,
// then most recent. Same auth pattern as the other endpoints - confirm
// the caller has at least one linked player, then read with the
// service-role key.
//
// Multi-child guardians: returns ONE combined feed across every linked
// child (consistent with get-my-notice-count's combined badge), not a
// feed scoped to whichever child is selected in the switcher. Each notice
// carries `for_children` (which of the caller's kids it's relevant to)
// and `is_read` is true only once EVERY relevant child has read it - so
// it keeps showing as unread until it's been seen on behalf of all of
// them, matching the combined badge logic exactly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { computeAgeGroup } from "../_shared/billing.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: playerIds, error: rpcErr } = await callerClient.rpc("current_player_ids");
  if (rpcErr || !playerIds || playerIds.length === 0) {
    return new Response(JSON.stringify({ error: "No linked player accounts for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-notices");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Need every linked child's own age group to filter targeted notices -
  // same computeAgeGroup() logic as get-my-profile/get-my-fixtures, so
  // all three stay consistent with each other by construction.
  const { data: players, error: playersErr } = await adminClient
    .from("players")
    .select("id, name, dob, age_group_override")
    .in("id", playerIds);

  if (playersErr || !players || players.length === 0) {
    return new Response(JSON.stringify({ error: "Player record not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const childMeta = players.map((p) => ({
    id: p.id,
    name: p.name,
    ageGroup: (p.age_group_override || computeAgeGroup(p.dob)).trim().toLowerCase(),
  }));

  const { data: notices, error: noticesErr } = await adminClient
    .from("notices")
    .select("id, title, body, category, pinned, posted_at, target_age_group")
    .order("pinned", { ascending: false })
    .order("posted_at", { ascending: false })
    .limit(50); // fetch generously; age-group filtering below trims to what's actually relevant

  if (noticesErr) {
    console.error("get-my-notices: failed to load notices", noticesErr);
    return new Response(JSON.stringify({ error: "Could not load notices - please try again." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // A notice with no target_age_group (or 'ALL') is for everyone;
  // anything else must match at least one linked child's own age group.
  const relevant = (notices ?? [])
    .map((n) => {
      const target = (n.target_age_group ?? "").trim().toLowerCase();
      const forChildren = childMeta.filter(
        (c) => target === "" || target === "all" || target === c.ageGroup
      );
      return { notice: n, forChildren };
    })
    .filter((n) => n.forChildren.length > 0)
    .slice(0, 30);

  // Fetch which of these notices each relevant child has already read, so
  // the client can show unread ones distinctly without a second round trip.
  const { data: reads } = await adminClient
    .from("notice_reads")
    .select("notice_id, player_id")
    .in("player_id", playerIds);

  const readPairs = new Set((reads ?? []).map((r) => `${r.notice_id}|${r.player_id}`));

  const withReadStatus = relevant.map(({ notice: n, forChildren }) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    category: n.category,
    pinned: n.pinned,
    posted_at: n.posted_at,
    for_children: forChildren.map((c) => ({ id: c.id, name: c.name })),
    // Read only once every relevant child has read it - keeps this in
    // lockstep with get-my-notice-count's combined badge logic.
    is_read: forChildren.every((c) => readPairs.has(`${n.id}|${c.id}`)),
  }));

  return new Response(JSON.stringify({ notices: withReadStatus }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
