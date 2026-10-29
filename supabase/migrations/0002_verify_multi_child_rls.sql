-- 0002_verify_multi_child_rls.sql
--
-- NOT a migration to run blindly - this is a READ-ONLY verification
-- query, split into two parts. It closes out "STEP 5" of
-- 0001_multi_child_guardian_access.sql, which asked whoever ran that
-- migration to hand-find and hand-rewrite every RLS policy still
-- comparing against the old single-child current_player_id() instead of
-- current_player_ids() - and there's no record in this codebase of
-- whether that was ever finished.
--
-- Run PART 1 in the Supabase SQL Editor and share the output before any
-- remediation migration gets written - guessing at policy names/
-- definitions from application code alone risks writing a migration
-- that doesn't match what's actually deployed.
--
-- ============================================================================
-- PART 1 - find every policy still on the old single-child function.
-- ============================================================================
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where qual ilike '%current_player_id(%'
   or with_check ilike '%current_player_id(%'
order by tablename, policyname;

-- A completely empty result set means STEP 5 was already finished (or
-- every policy on these tables was written some other way that doesn't
-- reference the function by name, which is worth an eyeball too - see
-- PART 2). Any row returned here is a policy still scoped to only ONE of
-- a multi-child guardian's linked players.

-- ============================================================================
-- PART 2 - sanity check: list every policy on the tables this app's own
-- Edge Functions touch, regardless of whether it mentions
-- current_player_id at all. Useful context alongside PART 1, since a
-- policy could also be missing entirely, or scoped some other way that's
-- worth a second pair of eyes.
-- ============================================================================
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where tablename in (
  'players',
  'payments',
  'tiers',
  'player_status_log',
  'guardian_players',
  'notices',
  'notice_reads',
  'matches',
  'partners',
  'staff',
  'api_rate_limits'
)
order by tablename, policyname;

-- ============================================================================
-- WHY THIS MATTERS LESS THAN IT MIGHT LOOK, BUT STILL MATTERS
-- ============================================================================
-- The player app's own Edge Functions never rely on these policies as
-- their security boundary - every one of them authenticates the caller,
-- resolves their linked player id(s) explicitly via
-- resolveRequestedPlayerId()/current_player_ids(), and then reads/writes
-- using the SERVICE-ROLE key (which bypasses RLS entirely) with an
-- explicit .eq('player_id', ...) filter. Confirmed: no page in this app
-- ever calls supabase.from(...) or supabase.rpc(...) directly - every
-- data read/write goes through an Edge Function.
--
-- So an incomplete STEP 5 does NOT currently break anything a guardian
-- sees in this app. It matters for two other reasons, both real:
--   1. RLS is the only thing standing between a stolen/leaked access
--      token and direct PostgREST access to this data, bypassing the
--      app (and its Edge Function checks) entirely.
--   2. This Supabase project's database is SHARED with the separate
--      Club Management (admin/staff) app (per YOCO_SETUP.md), which may
--      query these same tables directly rather than through an Edge
--      Function - in which case an unfinished STEP 5 could be actively
--      wrong for that app today, not just a latent risk.
