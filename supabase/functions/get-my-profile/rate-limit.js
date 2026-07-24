// Shared rate-limiting helper - copied into each Edge Function's own
// folder (same pattern as billing.js being reused across functions),
// since Edge Functions can't easily share code across separate deploys.
//
// Design: a small table (api_rate_limits) records one row per request,
// per user, per endpoint. Before doing real work, a function asks "how
// many requests has this user made to this endpoint in the last N
// seconds?" - if over the threshold, reject with 429. Old rows for that
// user+endpoint are deleted as part of the same check, so the table
// never grows large without needing a separate cleanup job.
//
// Fails OPEN, not closed: if the rate-limit check itself errors (e.g. a
// transient DB issue), the request is allowed through rather than
// blocking a legitimate user because of unrelated infrastructure trouble.
// Rate limiting is a safety net against abuse, not a feature the app's
// correctness depends on.

export async function checkRateLimit(
  adminClient,
  userId,
  endpoint,
  { maxRequests = 30, windowSeconds = 60 } = {}
) {
  try {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

    // Housekeeping: drop this user+endpoint's old rows so the table
    // stays small, before counting what's left.
    await adminClient
      .from("api_rate_limits")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .lt("requested_at", windowStart);

    const { count, error } = await adminClient
      .from("api_rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("endpoint", endpoint)
      .gte("requested_at", windowStart);

    if (error) return { allowed: true };

    if ((count ?? 0) >= maxRequests) {
      return { allowed: false };
    }

    await adminClient.from("api_rate_limits").insert({ user_id: userId, endpoint });
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
