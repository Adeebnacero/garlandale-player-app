-- 0003_fix_multi_child_rls.sql
--
-- Closes out STEP 5 of 0001_multi_child_guardian_access.sql. Rewrites
-- every policy still on the old single-child current_player_id() to use
-- current_player_ids() (SETOF uuid, sourced from guardian_players)
-- instead, per the verification query run against pg_policies on
-- 2026-08-07 (0002_verify_multi_child_rls.sql), which found 9 policies
-- across 6 tables still on the old function.
--
-- NOTE: this migration was run directly in the Supabase SQL Editor on
-- 2026-08-07 and confirmed successful (the verification query at the
-- bottom returned zero rows immediately after). This file is committed
-- after the fact purely so the change has a version-controlled record -
-- running it again is safe either way, since ALTER POLICY is idempotent
-- for the same expression.
--
-- Uses ALTER POLICY rather than DROP + CREATE, so each policy's existing
-- role assignment is left untouched - only the USING/WITH CHECK
-- expressions change.

-- players: scope both read and update to every linked child, not just one
alter policy players_select_own on public.players
  using (id in (select current_player_ids()));

alter policy players_update_own on public.players
  using (id in (select current_player_ids()))
  with check (id in (select current_player_ids()));

-- payments: same fix, read-only
alter policy payments_select_own on public.payments
  using (player_id in (select current_player_ids()));

-- notice_reads: read and insert, scoped per child
alter policy notice_reads_select_own on public.notice_reads
  using (player_id in (select current_player_ids()));

alter policy notice_reads_insert_own on public.notice_reads
  with check (player_id in (select current_player_ids()));

-- matches, notices, partners: these only ever checked "is this guardian
-- linked to *any* player" (not scoped to a specific child), so the fix
-- here is just swapping to the set-returning equivalent of that same
-- check - there's no per-child behavior change to worry about.
alter policy matches_player_read on public.matches
  using (exists (select 1 from current_player_ids()));

alter policy matches_select_for_players on public.matches
  using (exists (select 1 from current_player_ids()));

alter policy notices_select_for_players on public.notices
  using (exists (select 1 from current_player_ids()));

alter policy partners_select_for_players on public.partners
  using (exists (select 1 from current_player_ids()));

-- Verification - confirmed zero rows returned on 2026-08-07.
select tablename, policyname
from pg_policies
where qual ilike '%current_player_id(%'
   or with_check ilike '%current_player_id(%';

-- Separate, known issue spotted while drafting this migration, left
-- untouched here since it's unrelated to the multi-child fix:
-- matches_player_read and matches_select_for_players are functionally
-- identical policies (same table, same command, same check, different
-- names). Worth a follow-up cleanup migration to drop one of them.
