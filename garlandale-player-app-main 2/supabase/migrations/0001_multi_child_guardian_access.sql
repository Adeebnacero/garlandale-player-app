-- 0001_multi_child_guardian_access.sql
--
-- Moves guardian access from a 1:1 (one auth user = one player) model to a
-- many-to-many one, so a guardian with multiple children at the club can
-- see all of them from a single login.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (or via `supabase db push`), and
-- read every "CHECK BEFORE RUNNING" comment first - this touches your
-- existing auth model and one assumption below needs to match your schema.
--
-- ============================================================================
-- STEP 0 - CHECK BEFORE RUNNING
-- ============================================================================
-- This migration assumes your `players` table has a column called
-- `auth_user_id` that stores the linked Supabase Auth user's id (this is
-- the column current_player_id() presumably reads from today). Confirm the
-- real column name first:
--
--   select column_name from information_schema.columns
--   where table_name = 'players' and table_schema = 'public';
--
--   select pg_get_functiondef(oid) from pg_proc where proname = 'current_player_id';
--
-- If your column is named something else (e.g. user_id), replace
-- `auth_user_id` below with the real name before running STEP 2.
-- ============================================================================

-- STEP 1 - the join table. One row per guardian-child relationship, so a
-- guardian with 3 kids gets 3 rows, all with the same auth_user_id.
create table if not exists public.guardian_players (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  player_id    uuid not null references public.players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (auth_user_id, player_id)
);

alter table public.guardian_players enable row level security;

-- A guardian can read their own links (not required by the Edge Functions,
-- which use the service-role key, but useful for any direct-from-client
-- reads and for debugging in the SQL editor as that user).
drop policy if exists "guardians can read their own links" on public.guardian_players;
create policy "guardians can read their own links"
  on public.guardian_players for select
  using (auth_user_id = auth.uid());

-- STEP 2 - backfill from the existing 1:1 column.
-- ADJUST `auth_user_id` BELOW IF YOUR PLAYERS TABLE USES A DIFFERENT NAME.
insert into public.guardian_players (auth_user_id, player_id)
select auth_user_id, id
from public.players
where auth_user_id is not null
on conflict do nothing;

-- STEP 3 - the new lookup function every Edge Function / RLS policy should
-- move to: all players this caller may access, instead of just one.
create or replace function public.current_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select player_id
  from public.guardian_players
  where auth_user_id = auth.uid();
$$;

-- STEP 4 - keep current_player_id() alive during rollout, redefined as
-- "the first linked player", so anything not yet updated to
-- current_player_ids() doesn't break for single-child guardians (the
-- overwhelming majority of accounts). Safe to drop once every Edge
-- Function and RLS policy has moved over (see STEP 5).
create or replace function public.current_player_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select player_id
  from public.guardian_players
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- ============================================================================
-- STEP 5 - RLS POLICIES: MANUAL STEP, RUN THIS QUERY FIRST
-- ============================================================================
-- Any existing RLS policy written as `... = current_player_id()` will now
-- only ever match ONE of a guardian's children (whichever one
-- current_player_id() happens to return), even though the Edge Functions
-- have been updated to use current_player_ids(). Find them with:
--
--   select schemaname, tablename, policyname, qual
--   from pg_policies
--   where qual ilike '%current_player_id%' or with_check ilike '%current_player_id%';
--
-- For each one found, change the comparison style from:
--   id = current_player_id()
-- to:
--   id in (select current_player_ids())
--
-- (or the equivalent for whatever column that policy is scoping, e.g.
-- `player_id = current_player_id()` on notice_reads/payments/etc becomes
-- `player_id in (select current_player_ids())`). One specific one to
-- check: `notice_reads_insert_own`, referenced in mark-notice-read's own
-- comments - it's no longer load-bearing for THIS app's own traffic
-- (mark-notice-read now writes via the service-role key so it can mark
-- more than one linked child's row in one request), but should still be
-- widened as defense-in-depth against direct PostgREST access. This
-- migration can't do that step for you sight-unseen since it means
-- editing policies whose exact definitions aren't visible from the
-- application code - the query above will list every policy that needs
-- it.
-- ============================================================================
