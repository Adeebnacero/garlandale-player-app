// Shared helper for every per-child Edge Function (get-my-balance,
// get-my-fixtures, get-my-loyalty, get-my-active-status, get-my-profile,
// update-my-profile). Centralizes the "which of this guardian's linked
// children is this request for, and are they actually allowed to ask about
// that one" check, so it's written and tested once instead of copied into
// six functions with six chances to get the 403 check subtly wrong.
//
// Call current_player_ids() (not the old current_player_id()) as the
// caller, then:
//   - if the request didn't specify a player_id, default to the first
//     linked player - this keeps every existing single-child guardian and
//     any not-yet-updated client working with zero change on their end.
//   - if it did specify one, it MUST be in the caller's own linked set,
//     or reject. This is the actual security boundary preventing one
//     guardian from requesting another family's child by id.
export async function resolveRequestedPlayerId(callerClient, requestedPlayerId) {
  const { data: playerIds, error } = await callerClient.rpc("current_player_ids");

  if (error || !playerIds || playerIds.length === 0) {
    return { ok: false, status: 403, error: "No linked player accounts for this user" };
  }

  if (!requestedPlayerId) {
    return { ok: true, playerId: playerIds[0], allPlayerIds: playerIds };
  }

  if (!playerIds.includes(requestedPlayerId)) {
    return { ok: false, status: 403, error: "Not authorized for this player account" };
  }

  return { ok: true, playerId: requestedPlayerId, allPlayerIds: playerIds };
}
