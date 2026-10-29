-- Garlandale FC club management schema (v2)
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).

create extension if not exists "pgcrypto";

-- ---------- players ----------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dob date,
  age_group_override text default '',
  phone text default '',
  email text default '',
  guardian_name text default '',
  guardian_phone text default '',
  join_date date,
  billing_start_date date,         -- when subscription billing actually starts accruing;
                                    -- NULL means "same as join_date" (the normal case for
                                    -- new registrations). Set this separately for
                                    -- long-standing members whose real join date predates
                                    -- this billing system, so they aren't retroactively
                                    -- billed for decades of "seasons" before it existed.
  monthly_fee numeric default 0,
  documents_complete boolean default false,
  notes text default '',
  reg_no text unique,              -- federation-issued player number, blank until registered, unique once issued
  squad_number int,                -- usual jersey number (editable per match)
  user_id uuid unique references auth.users(id) on delete set null,
                                    -- links this player row to their OWN auth account, if they've
                                    -- claimed an app invite (see invite-player Edge Function). NULL
                                    -- until claimed - a player row with no account is still just
                                    -- normal club data, exactly as before. Deliberately the opposite
                                    -- direction of the staff table (staff.user_id -> role): here,
                                    -- players.user_id -> a specific player row, one-to-one.
  created_at timestamptz default now()
);

-- ---------- payments ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  amount numeric not null,
  date date not null,
  method text default 'EFT',
  created_at timestamptz default now()
);

create index if not exists payments_player_id_idx on payments(player_id);

-- ---------- active/inactive status history ----------
alter table players add column if not exists active boolean default true;

create table if not exists player_status_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  status text not null, -- 'active' or 'inactive'
  changed_at timestamptz default now()
);

create index if not exists player_status_log_player_id_idx on player_status_log(player_id);

-- If you already ran the v1 schema and are only adding these columns:
alter table players add column if not exists reg_no text;
alter table players add column if not exists squad_number int;
alter table players add column if not exists billing_start_date date;
alter table players add column if not exists user_id uuid references auth.users(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'players_user_id_key') then
    alter table players add constraint players_user_id_key unique (user_id);
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'players_reg_no_key') then
    alter table players add constraint players_reg_no_key unique (reg_no);
  end if;
end $$;

-- ---------- subscription tiers ----------
create table if not exists tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_fee numeric not null default 0,
  description text default '',
  created_at timestamptz default now()
);

alter table players add column if not exists tier_id uuid references tiers(id);
-- Note: players.monthly_fee is kept for backward compatibility but is no
-- longer used by the app — fees now come from the assigned tier via tier_id.

-- ---------- matches (fixtures) ----------
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  league_name text default 'Cape Town Tygerberg LFA',
  home_team text default 'Garlandale FC',
  opponent text not null,
  home_away text default 'H',           -- 'H' or 'A'
  venue text default '',
  match_date date,
  kickoff_time time,
  division text default '',
  competition text default '',
  age_group text default '',
  corner_flags text default '',
  field_conditions text default '',
  field_marking text default '',
  first_aid_present text default '',
  referee_name text default '',
  assistant_ref_1 text default '',
  assistant_ref_2 text default '',
  half_time_score_home text default '',
  full_time_score_home text default '',
  half_time_score_away text default '',
  full_time_score_away text default '',
  coach_name text default '',
  coach_reg_no text default '',
  manager_name text default '',
  manager_reg_no text default '',
  captain_player_id uuid references players(id),
  physio_name text default '',
  physio_reg_no text default '',
  comments text default '',
  fixture_id uuid,  -- links back to the fixtures row this Matchday entry was created from, if any (FK added below, after fixtures exists)
  created_at timestamptz default now()
);

alter table matches add column if not exists fixture_id uuid;

-- ---------- match squad selections ----------
create table if not exists match_squad (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  slot_no int not null,           -- 1-11 starting, 12-20 subs, matching the official sheet's NO column
  jersey_no text default '',
  role text default 'starting',  -- 'starting' or 'sub'
  goals int default 0,
  assists int default 0,
  created_at timestamptz default now(),
  unique (match_id, slot_no),
  unique (match_id, player_id)
);

alter table match_squad add column if not exists goals int default 0;
alter table match_squad add column if not exists assists int default 0;

-- ---------- kit inventory ----------
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,             -- e.g. "Home jersey", "Training bib"
  category text default '',       -- e.g. "Jersey", "Shorts", "Tracksuit"
  size text default '',
  quantity_on_hand int default 0,
  created_at timestamptz default now()
);

-- ---------- kit issued to players ----------
create table if not exists issued_items (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  item_id uuid not null references inventory_items(id) on delete cascade,
  size text default '',
  quantity int default 1,
  date_issued date default current_date,
  date_returned date,
  notes text default '',
  created_at timestamptz default now()
);

create index if not exists issued_items_player_id_idx on issued_items(player_id);
create index if not exists match_squad_match_id_idx on match_squad(match_id);

-- ---------- club assets (equipment/stock - balls, bibs, poles, flags, etc.) ----------
-- Distinct from inventory_items/issued_items above, which track kit issued
-- TO PLAYERS. This tracks general club-owned equipment and its value.
create table if not exists club_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- e.g. "Match balls (size 5)", "Lawnmower"
  category text default 'Other',         -- "Equipment", "Grounds", "Other"
  quantity int default 0,
  unit_value numeric default 0,
  low_stock_threshold int default 0,     -- flag as low stock when quantity <= this
  notes text default '',
  created_at timestamptz default now()
);

-- ---------- finance ledger (bank/cash log, donations, other income/expense) ----------
-- Subscription payments are NOT duplicated here - the app reads them live
-- from the existing payments table and merges them into this ledger's view,
-- so there's only ever one source of truth for a subscription payment.
-- This table is only for everything else: manual bank transactions,
-- donations, and other income/expenses, plus a one-off opening balance
-- entry (category 'Opening Balance') so the running total starts accurate.
create table if not exists finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  description text not null,
  category text default 'Other income',
  type text not null check (type in ('income', 'expense')),
  amount numeric not null default 0,
  created_at timestamptz default now()
);

-- ---------- monthly payment reminder batches ----------
-- Deliberately minimal: this table does NOT store who owes what or
-- recompute any billing math server-side. It only flags "reminders are
-- due" once a month. The actual list of who owes money is worked out by
-- the app itself at review time, using the exact same tested client-side
-- billing logic already used everywhere else in the app (see
-- src/lib/billing.js) - avoiding a second, server-side copy of that math
-- that could quietly drift out of sync with the real one.
create table if not exists reminder_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'dismissed'))
);

-- ---------- audit log (financially sensitive tables only) ----------
-- Populated entirely by database triggers, not application code - this is
-- deliberate: a trigger fires no matter HOW a row changes (through the app,
-- a direct SQL edit, anything), so it can't be bypassed or forgotten the
-- way a client-side "please also log this" call could be. Covers only the
-- financially sensitive tables (payments, finance_entries, tiers,
-- club_assets), matching the club's actual priority here.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_by_email text,
  changed_at timestamptz default now()
);

create or replace function audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
begin
  select email into actor_email from staff where user_id = auth.uid();

  insert into audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_by_email)
  values (
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    TG_OP,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid(),
    actor_email
  );

  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

drop trigger if exists audit_payments on payments;
create trigger audit_payments after insert or update or delete on payments
  for each row execute function audit_log_trigger();

drop trigger if exists audit_finance_entries on finance_entries;
create trigger audit_finance_entries after insert or update or delete on finance_entries
  for each row execute function audit_log_trigger();

drop trigger if exists audit_tiers on tiers;
create trigger audit_tiers after insert or update or delete on tiers
  for each row execute function audit_log_trigger();

drop trigger if exists audit_club_assets on club_assets;
create trigger audit_club_assets after insert or update or delete on club_assets
  for each row execute function audit_log_trigger();

-- Note: restoring a backup (restore_from_snapshot) deletes and re-inserts
-- every row in these tables, which means a restore will generate a large
-- burst of audit entries - one per row touched. This is expected: restores
-- are rare, deliberate, high-impact actions, and having a record that one
-- happened (and exactly what it changed) is arguably a feature, not noise.

-- ---------- league table (scraped from the federation's public standings pages) ----------
-- Configured once in Settings: a friendly label + the federation's public
-- standings URL for each of Garlandale's divisions. A scheduled job
-- (weekly, Monday mornings) fetches and parses each URL via the
-- fetch-league-tables Edge Function, replacing league_standings with
-- fresh data. If a fetch or parse ever fails, the LAST successfully
-- fetched data is deliberately left in place rather than wiped - a stale
-- table is more useful than a blank one, and this guards against a
-- temporary site outage or a change to LeagueRepublic's page layout
-- silently wiping out real, useful data.
create table if not exists league_table_sources (
  id uuid primary key default gen_random_uuid(),
  division_label text not null,
  source_url text not null,
  display_order int default 0,
  last_fetched_at timestamptz,
  last_fetch_error text,
  created_at timestamptz default now()
);

create table if not exists league_standings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references league_table_sources(id) on delete cascade,
  position int,
  team_name text not null,
  played int default 0,
  won int default 0,
  drawn int default 0,
  lost int default 0,
  goals_for int default 0,
  goals_against int default 0,
  goal_difference int default 0,
  points int default 0,
  is_garlandale boolean default false,
  fetched_at timestamptz default now()
);

-- ---------- notice board (built for the player-facing app; this admin app writes to it) ----------
-- This table already exists live (created directly for the player app's
-- read side, which is done and unrelated to this file) - defined here with
-- `if not exists` purely so this schema file is a true reflection of what's
-- actually deployed, matching every other table in this project. The
-- player app's own read policy (notices_select_for_players) is untouched;
-- this only adds what staff need to actually write to it.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text default 'announcement',  -- 'announcement' or 'training'
  pinned boolean default false,          -- pinned notices sort first
  posted_by_email text default '',       -- who posted it, for cheap display without a join - set by trigger below, not client-supplied
  posted_by uuid references staff(id),   -- who posted it, the real FK used by the RLS ownership checks below
  target_age_group text,                 -- null or 'ALL' = every player; otherwise must match a real age-group value (see matches.age_group, computeAgeGroup() in billing.js)
  posted_at timestamptz default now()
);

alter table notices add column if not exists posted_by_email text default '';
alter table notices add column if not exists posted_by uuid references staff(id);
alter table notices add column if not exists target_age_group text;

-- ---------- coach team assignments ----------
-- Which age group(s) each coach is allowed to post notices to. A coach can
-- be assigned more than one team (e.g. running both U16 and U18), hence a
-- join table rather than a single column. Admin/Treasurer aren't
-- restricted by this at all (see the notices RLS policies below) - this
-- table only matters for coaches.
create table if not exists staff_teams (
  staff_id uuid not null references staff(id) on delete cascade,
  age_group text not null,
  primary key (staff_id, age_group)
);

-- Mirrors current_player_id() - returns the staff.id for whoever's
-- currently logged in, or null if the caller isn't staff at all.
create or replace function current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from staff where user_id = auth.uid() limit 1;
$$;

grant execute on function current_staff_id() to authenticated;

-- Soft-adds a category constraint without erroring if any existing row
-- happens to already hold something outside these two values (NOT VALID
-- means it applies to all future writes immediately, without checking
-- historical rows). If you want to confirm existing data is clean too, run
-- `alter table notices validate constraint notices_category_check;`
-- separately once you've checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notices_category_check') then
    alter table notices add constraint notices_category_check check (category in ('announcement', 'training')) not valid;
  end if;
end $$;

-- Widen the category check to also allow 'birthday' (see the automated
-- birthday-notice job further down). Drop + recreate rather than editing
-- in place, since Postgres has no ALTER CONSTRAINT for check clauses.
alter table notices drop constraint if exists notices_category_check;
alter table notices add constraint notices_category_check check (category in ('announcement', 'training', 'birthday')) not valid;

-- Which player a notice is about, if any. Only ever set for category =
-- 'birthday' notices (see create_birthday_notices() below) - lets that job
-- tell "has today's notice for this player already gone out" apart from
-- just matching on title text, and lets the daily cleanup job target
-- exactly the right rows. NULL for every ordinary staff-authored notice.
alter table notices add column if not exists related_player_id uuid references players(id) on delete cascade;

-- Auto-fills posted_by_email from whoever is actually logged in - not
-- trusted from client input, same reasoning as audit_log_trigger.
create or replace function set_notice_posted_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fill this in when it wasn't already supplied. A genuine new post
  -- from the client omits it entirely (gets auto-filled here, correctly,
  -- from whoever's actually logged in). A backup restore explicitly
  -- provides the real historical value from the snapshot - without this
  -- check, restoring a backup would silently overwrite every notice's
  -- attribution with whoever happens to be running the restore.
  if new.posted_by_email is null or new.posted_by_email = '' then
    select email into new.posted_by_email from staff where user_id = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists notices_set_posted_by on notices;
create trigger notices_set_posted_by before insert on notices
  for each row execute function set_notice_posted_by();

-- ---------- Push notifications: don't let a signed-in user un-send a notice ----------
-- Clearing push_sent_at would make the hourly job push a notice to phones
-- again. Only the job itself (service role) may do that - it hands notices
-- back if a run fails before sending. Signed-in staff can still edit
-- everything else, and setting it (as the restore does) is always fine.
create or replace function keep_notice_push_sent_at()
returns trigger
language plpgsql
as $$
begin
  if old.push_sent_at is not null
     and new.push_sent_at is distinct from old.push_sent_at
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') in ('authenticated', 'anon') then
    new.push_sent_at := old.push_sent_at;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notices' and column_name = 'push_sent_at') then
    drop trigger if exists notices_keep_push_sent_at on notices;
    create trigger notices_keep_push_sent_at before update of push_sent_at on notices
      for each row execute function keep_notice_push_sent_at();
  end if;
end $$;
-- (notices.push_sent_at and notices.urgent come from the Player Portal's
-- migration 0006_notice_pushes.sql; see migrations/2026-10-push-notifications.sql.)


-- ---------- division label mappings (fixture spreadsheet import) ----------
-- The federation's fixture spreadsheet uses its own division naming (e.g.
-- "D4 - 6th Division") which doesn't match the club's own friendly team
-- names (e.g. "1st Team"). This table remembers that translation once it's
-- taught, so future imports apply it automatically instead of asking again.
--
-- squad_age_group is a SEPARATE mapping from team_label: team_label is a
-- poster-friendly display name (e.g. "Under 12 'A'"), while squad_age_group
-- is meant to match a REAL age-group value used elsewhere in the app (the
-- same values computed from player DOB / ageGroupOverride in Squad). These
-- can differ - team_label is for humans reading the poster, squad_age_group
-- is for matching this division's fixtures up with the actual roster (used
-- by the player app to show a player only their own team's fixtures, and
-- potentially for auto-creating Matchday entries later).
create table if not exists division_labels (
  id uuid primary key default gen_random_uuid(),
  division_key text not null unique,  -- the raw division text as it appears in the spreadsheet
  team_label text not null,           -- the club's friendly name for that team
  squad_age_group text default '',    -- the real squad age-group this division corresponds to
  created_at timestamptz default now()
);

alter table division_labels add column if not exists squad_age_group text default '';

-- ---------- fixtures (federation spreadsheet import, shared across the app) ----------
-- The federation spreadsheet's own schedule data, extracted and stored once
-- so it can be reused anywhere: the Fixtures tab's table view, Fixtures
-- Post's poster/PDF selection, and the player app (a player's own team's
-- fixtures). Previously this data only existed transiently inside Fixtures
-- Post as parsed text with nowhere else to go - this table is what fixes
-- that.
--
-- Deduplicated/upserted on re-import: importing an overlapping date range
-- twice won't create duplicate rows, and if a fixture's time/venue changes
-- between imports (a genuine reschedule), the existing row is updated
-- rather than a second one created alongside it.
create table if not exists fixtures (
  id uuid primary key default gen_random_uuid(),
  division_key text not null,          -- raw division text, as it appears in the spreadsheet
  team_label text default '',          -- poster-friendly label, resolved via division_labels at import time
  squad_age_group text default '',     -- real squad age-group, resolved via division_labels at import time
  opponent text not null,
  match_date date not null,
  kickoff_time time,
  venue text default '',
  home_away text default 'H' check (home_away in ('H', 'A')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (opponent, match_date, division_key)
);

-- matches.fixture_id references this table - added here (not inline on
-- matches' own definition above) since fixtures didn't exist yet at that
-- point in the file. The unique constraint guarantees at most one Matchday
-- entry per fixture, which the "update the existing entry if one exists"
-- sync logic depends on.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_fixture_id_fkey') then
    alter table matches add constraint matches_fixture_id_fkey foreign key (fixture_id) references fixtures(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'matches_fixture_id_key') then
    alter table matches add constraint matches_fixture_id_key unique (fixture_id);
  end if;
end $$;

-- ---------- club settings (singleton row) ----------
-- Holds non-sensitive configuration the app needs. The Gmail App Password
-- itself is NEVER stored here - it lives only as a Supabase Edge Function
-- secret, since this table is readable by anyone with the anon key.
create table if not exists club_settings (
  id int primary key default 1,
  sender_email text default '',
  sender_display_name text default 'Garlandale FC',
  reply_to_email text default '',
  bank_details text default '',
  invoice_footer_note text default '',
  updated_at timestamptz default now(),
  constraint club_settings_singleton check (id = 1)
);

insert into club_settings (id) values (1) on conflict (id) do nothing;

-- ---------- backups ----------
-- Automatic nightly snapshots (kept for 30 days) plus on-demand backups
-- triggered manually from the app. Each row is a full copy of every table
-- at that point in time, stored as JSON.
create extension if not exists "pg_cron";
create extension if not exists "pg_net";

create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  kind text default 'scheduled', -- 'scheduled' or 'manual'
  snapshot jsonb not null
);

create index if not exists backups_created_at_idx on backups(created_at desc);

create or replace function create_backup_snapshot(p_kind text default 'scheduled')
returns uuid
language plpgsql
security definer
as $$
declare
  new_id uuid;
begin
  insert into backups (kind, snapshot)
  values (
    p_kind,
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from players p),
      'payments', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from payments p),
      'tiers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tiers t),
      'matches', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from matches m),
      'match_squad', (select coalesce(jsonb_agg(to_jsonb(ms)), '[]'::jsonb) from match_squad ms),
      'inventory_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from inventory_items i),
      'issued_items', (select coalesce(jsonb_agg(to_jsonb(ii)), '[]'::jsonb) from issued_items ii),
      'player_status_log', (select coalesce(jsonb_agg(to_jsonb(sl)), '[]'::jsonb) from player_status_log sl),
      'club_settings', (select coalesce(jsonb_agg(to_jsonb(cs)), '[]'::jsonb) from club_settings cs),
      'division_labels', (select coalesce(jsonb_agg(to_jsonb(dl)), '[]'::jsonb) from division_labels dl),
      'club_assets', (select coalesce(jsonb_agg(to_jsonb(ca)), '[]'::jsonb) from club_assets ca),
      'finance_entries', (select coalesce(jsonb_agg(to_jsonb(fe)), '[]'::jsonb) from finance_entries fe),
      'reminder_batches', (select coalesce(jsonb_agg(to_jsonb(rb)), '[]'::jsonb) from reminder_batches rb),
      'audit_log', (select coalesce(jsonb_agg(to_jsonb(al)), '[]'::jsonb) from audit_log al),
      'league_table_sources', (select coalesce(jsonb_agg(to_jsonb(lts)), '[]'::jsonb) from league_table_sources lts),
      'league_standings', (select coalesce(jsonb_agg(to_jsonb(ls)), '[]'::jsonb) from league_standings ls),
      'fixtures', (select coalesce(jsonb_agg(to_jsonb(fx)), '[]'::jsonb) from fixtures fx),
      'notices', (select coalesce(jsonb_agg(to_jsonb(nt)), '[]'::jsonb) from notices nt)
    )
  )
  returning id into new_id;

  -- prune anything older than 30 days so free-tier storage stays healthy
  delete from backups where created_at < now() - interval '30 days';

  return new_id;
end;
$$;

-- ---------- atomic restore (Phase 3 fix) ----------
-- Previously, restoring a backup ran as ~15 separate delete/insert calls
-- from the client, one table at a time. If any single call failed midway
-- (network blip, one bad row), the database was left in a partially
-- restored state with no way back - a real data-safety gap. Running this
-- as a single Postgres function fixes that: a PL/pgSQL function body is one
-- implicit transaction, so if anything inside fails, EVERYTHING in this
-- function rolls back automatically - either the whole restore succeeds or
-- none of it takes effect.
create or replace function restore_from_snapshot(snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  -- This function bypasses RLS (security definer), so the admin check has
  -- to happen explicitly here rather than relying on table policies.
  select role into caller_role from staff where user_id = auth.uid();
  if caller_role is distinct from 'admin' then
    raise exception 'Only an Admin can restore from a backup.';
  end if;

  -- Children first, then parents, respecting foreign keys.
  delete from issued_items;
  delete from match_squad;
  delete from payments;
  delete from player_status_log;
  delete from matches;
  delete from inventory_items;
  delete from players;
  delete from tiers;
  delete from division_labels;
  delete from club_assets;
  delete from finance_entries;
  delete from reminder_batches;
  delete from audit_log;
  delete from league_standings;
  delete from league_table_sources;
  delete from fixtures;
  delete from notices;

  -- Parents first, then children, on the way back in.
  insert into tiers
    select * from jsonb_populate_recordset(null::tiers, coalesce(snapshot->'tiers', '[]'::jsonb));
  insert into players
    select * from jsonb_populate_recordset(null::players, coalesce(snapshot->'players', '[]'::jsonb));
  insert into inventory_items
    select * from jsonb_populate_recordset(null::inventory_items, coalesce(snapshot->'inventory_items', '[]'::jsonb));
  insert into matches
    select * from jsonb_populate_recordset(null::matches, coalesce(snapshot->'matches', '[]'::jsonb));
  insert into payments
    select * from jsonb_populate_recordset(null::payments, coalesce(snapshot->'payments', '[]'::jsonb));
  insert into match_squad
    select * from jsonb_populate_recordset(null::match_squad, coalesce(snapshot->'match_squad', '[]'::jsonb));
  insert into issued_items
    select * from jsonb_populate_recordset(null::issued_items, coalesce(snapshot->'issued_items', '[]'::jsonb));
  insert into player_status_log
    select * from jsonb_populate_recordset(null::player_status_log, coalesce(snapshot->'player_status_log', '[]'::jsonb));
  insert into division_labels
    select * from jsonb_populate_recordset(null::division_labels, coalesce(snapshot->'division_labels', '[]'::jsonb));
  insert into club_assets
    select * from jsonb_populate_recordset(null::club_assets, coalesce(snapshot->'club_assets', '[]'::jsonb));
  insert into reminder_batches
    select * from jsonb_populate_recordset(null::reminder_batches, coalesce(snapshot->'reminder_batches', '[]'::jsonb));
  insert into audit_log
    select * from jsonb_populate_recordset(null::audit_log, coalesce(snapshot->'audit_log', '[]'::jsonb));
  insert into league_table_sources
    select * from jsonb_populate_recordset(null::league_table_sources, coalesce(snapshot->'league_table_sources', '[]'::jsonb));
  insert into league_standings
    select * from jsonb_populate_recordset(null::league_standings, coalesce(snapshot->'league_standings', '[]'::jsonb));
  insert into finance_entries
    select * from jsonb_populate_recordset(null::finance_entries, coalesce(snapshot->'finance_entries', '[]'::jsonb));
  insert into fixtures
    select * from jsonb_populate_recordset(null::fixtures, coalesce(snapshot->'fixtures', '[]'::jsonb));
  insert into notices
    select * from jsonb_populate_recordset(null::notices, coalesce(snapshot->'notices', '[]'::jsonb));
  -- Restored notices never go to phones (again): mark them as handled for
  -- the Player Portal's hourly push job. Checked by name so this still
  -- works on a database that doesn't have push notifications set up.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notices' and column_name = 'push_sent_at') then
    execute 'update notices set push_sent_at = now() where push_sent_at is null';
  end if;

  if snapshot ? 'club_settings' and jsonb_array_length(coalesce(snapshot->'club_settings', '[]'::jsonb)) > 0 then
    insert into club_settings
      select * from jsonb_populate_recordset(null::club_settings, snapshot->'club_settings')
    on conflict (id) do update set
      sender_email = excluded.sender_email,
      sender_display_name = excluded.sender_display_name,
      reply_to_email = excluded.reply_to_email,
      bank_details = excluded.bank_details,
      invoice_footer_note = excluded.invoice_footer_note,
      updated_at = excluded.updated_at;
  end if;
end;
$$;

grant execute on function restore_from_snapshot(jsonb) to authenticated;

-- Schedule the nightly snapshot for 21:00 UTC = 23:00 (11pm) Cape Town time
-- (SAST is UTC+2 year-round, no daylight saving). Re-running this schema is
-- safe - it clears any existing job with this name before re-scheduling.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-nightly-backup') then
    perform cron.unschedule('garlandale-nightly-backup');
  end if;
end $$;

select cron.schedule(
  'garlandale-nightly-backup',
  '0 21 * * *',
  $$select create_backup_snapshot('scheduled');$$
);

-- ---------- monthly payment reminder batch ----------
-- Creates a fresh "reminders due" flag on the 1st of each month. Any
-- previous still-unreviewed batch is dismissed first, so there's only ever
-- one active batch at a time and the Treasurer always sees a batch that
-- reflects the current month, not a stale leftover from one they missed.
create or replace function create_monthly_reminder_batch()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update reminder_batches set status = 'dismissed' where status = 'pending';
  insert into reminder_batches (status) values ('pending');
end;
$$;

-- Runs at 06:00 UTC = 08:00 (8am) Cape Town time on the 1st of every month.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-monthly-payment-reminders') then
    perform cron.unschedule('garlandale-monthly-payment-reminders');
  end if;
end $$;

select cron.schedule(
  'garlandale-monthly-payment-reminders',
  '0 6 1 * *',
  $$select create_monthly_reminder_batch();$$
);

-- ---------- daily birthday notices ----------
-- Posts one Notice Board entry per player whose birthday is today, targeted
-- at their own age group, so the whole team sees it. Runs as the database
-- itself (security definer), not as any logged-in staff member, so it's not
-- limited by a coach's own team assignment the way a client-triggered post
-- would be - it can post for every age group unconditionally, and doesn't
-- rely on anyone actually opening the app on the day in question.
--
-- Age-group logic mirrors computeAgeGroup() in src/lib/billing.js (English/
-- SA grassroots convention: cutoff birthday is 31 August). Keep the two in
-- sync if that function's rules ever change.
create or replace function create_birthday_notices()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Africa/Johannesburg')::date; -- SA local calendar day
  cutoff_year int;
  p record;
  computed_age_group text;
begin
  -- Clear out yesterday's (and any older) birthday notices first, so the
  -- board never shows more than ~24h of birthday clutter and today's fresh
  -- run always starts from a clean slate.
  delete from notices where category = 'birthday' and posted_at < now() - interval '48 hours';

  cutoff_year := case when extract(month from today) >= 9 then extract(year from today) + 1 else extract(year from today) end;

  for p in
    select id, name, dob, age_group_override
    from players
    where dob is not null
      and extract(month from dob) = extract(month from today)
      and extract(day from dob) = extract(day from today)
  loop
    if p.age_group_override is not null and p.age_group_override <> '' then
      computed_age_group := p.age_group_override;
    else
      declare
        age int := cutoff_year - extract(year from p.dob)::int;
      begin
        computed_age_group := case
          when age >= 18 then 'Seniors'
          when age <= 0 then 'Unassigned'
          else 'U' || age
        end;
      end;
    end if;

    if computed_age_group is null or computed_age_group = 'Unassigned' then
      continue; -- no valid age group to target - skip rather than guess
    end if;

    -- Dedupe: skip if today's notice for this player already went out (in
    -- case the job is ever run more than once in the same day).
    if exists (
      select 1 from notices
      where category = 'birthday'
        and related_player_id = p.id
        and posted_at::date = today
    ) then
      continue;
    end if;

    insert into notices (title, body, category, pinned, target_age_group, related_player_id, posted_by_email)
    values (
      '🎂 ' || split_part(p.name, ' ', 1) || '''s Birthday!',
      'It''s ' || split_part(p.name, ' ', 1) || '''s birthday today! Let''s all join in and wish them a Happy Birthday from the Garlandale FC family! 🎉',
      'birthday',
      true,
      computed_age_group,
      p.id,
      'Garlandale FC'
    );
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-daily-birthday-notices') then
    perform cron.unschedule('garlandale-daily-birthday-notices');
  end if;
end $$;

-- Runs daily at 05:00 UTC = 07:00 (7am) Cape Town time, ahead of the
-- weekly league refresh and well before a typical training/matchday.
select cron.schedule(
  'garlandale-daily-birthday-notices',
  '0 5 * * *',
  $$select create_birthday_notices();$$
);

-- ---------- weekly league table refresh ----------
-- Calls the fetch-league-tables Edge Function every Monday morning (07:00
-- UTC = 09:00 Cape Town time), after the weekend's matches have been
-- played and the federation's site has had time to update.
--
-- IMPORTANT: replace BOTH placeholders below before running this section -
-- they're specific to your own Supabase project and can't be filled in
-- generically here:
--   YOUR_PROJECT_REF      -> Project Settings -> API -> Project URL
--   YOUR_SERVICE_ROLE_KEY -> Project Settings -> API -> service_role secret
-- If you skip this step, the job will run on schedule but silently fail
-- to reach the function - check Settings -> League table sources for a
-- "Last fetched" error message if the table never updates.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-weekly-league-tables') then
    perform cron.unschedule('garlandale-weekly-league-tables');
  end if;
end $$;

select cron.schedule(
  'garlandale-weekly-league-tables',
  '0 7 * * 1',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/fetch-league-tables',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- ---------- Staff accounts & roles ----------
-- Every logged-in user needs a row here to have any access at all. Roles:
--   admin     - full access to everything, including inviting/managing staff
--   treasurer - subscriptions/tiers/settings/messages; read-only on players;
--               no access to matches/kit
--   coach     - players/matchday/kit; read-only on financial tables (the
--               app's interface never surfaces $ figures to this role, even
--               though the database technically allows read access - see
--               README for why this trade-off was made)
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'treasurer', 'coach')),
  invited_at timestamptz default now()
);

create or replace function current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from staff where user_id = auth.uid() limit 1;
$$;

-- Mirrors current_staff_role() above, but for players: returns the player
-- row id linked to the currently logged-in account, or null if the caller
-- isn't a player (e.g. they're staff, or a player who hasn't claimed their
-- app invite yet). This is groundwork for the player-facing app's own RLS
-- policies (e.g. "a player may only see their own payments") - none of
-- those policies exist yet; this function just makes them possible to add
-- later without revisiting the players table again.
create or replace function current_player_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from players where user_id = auth.uid() limit 1;
$$;

grant execute on function current_player_id() to authenticated;

-- ---------- Role permissions (Phase 4 refactor) ----------
-- Previously, every table's access rules were written inline across 22
-- separate CREATE POLICY statements (e.g. "current_staff_role() in ('admin',
-- 'coach')" repeated per table/action). Adding or changing a role meant
-- hunting down and editing every one of those statements individually, with
-- real risk of missing one. This table + one generic function replaces all
-- of that: permissions are now data (rows here), not scattered SQL.
--
-- The seed values below reproduce the EXACT same access rules the app had
-- before this refactor - this is a restructuring, not a behavior change.
create table if not exists role_permissions (
  role text not null,
  table_name text not null,
  can_select boolean not null default false,
  can_insert boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  primary key (role, table_name)
);

insert into role_permissions (role, table_name, can_select, can_insert, can_update, can_delete) values
  ('admin',     'players',           true,  true,  true,  true),
  ('treasurer', 'players',           true,  false, false, false),
  ('coach',     'players',           true,  true,  true,  true),

  ('admin',     'payments',          true,  true,  true,  true),
  ('treasurer', 'payments',          true,  true,  true,  true),
  ('coach',     'payments',          true,  false, false, false),

  ('admin',     'tiers',             true,  true,  true,  true),
  ('treasurer', 'tiers',             true,  true,  true,  true),
  ('coach',     'tiers',             true,  false, false, false),

  ('admin',     'club_settings',     true,  false, true,  false),
  ('treasurer', 'club_settings',     true,  false, true,  false),
  ('coach',     'club_settings',     true,  false, false, false),

  ('admin',     'division_labels',   true,  true,  true,  true),
  ('treasurer', 'division_labels',   true,  true,  true,  true),

  -- notices: only the 'select' column here actually matters now - insert/
  -- update/delete for notices has its own dedicated per-row policy logic
  -- (age-group targeting, ownership) that doesn't consult this table at
  -- all, so changing true/false here for those three columns has no
  -- effect. Left as true/true/true for all three roles mostly so the
  -- table reads honestly (everyone actually can write, just under more
  -- specific rules than a blanket permission check can express).
  ('admin',     'notices',           true,  true,  true,  true),
  ('treasurer', 'notices',           true,  true,  true,  true),
  ('coach',     'notices',           true,  true,  true,  true),

  ('admin',     'fixtures',          true,  true,  true,  true),
  ('treasurer', 'fixtures',          true,  true,  true,  true),
  ('coach',     'fixtures',          true,  false, false, false),

  ('admin',     'matches',           true,  true,  true,  true),
  ('coach',     'matches',           true,  true,  true,  true),

  ('admin',     'match_squad',       true,  true,  true,  true),
  ('coach',     'match_squad',       true,  true,  true,  true),

  ('admin',     'inventory_items',   true,  true,  true,  true),
  ('coach',     'inventory_items',   true,  true,  true,  true),

  ('admin',     'club_assets',       true,  true,  true,  true),
  ('coach',     'club_assets',       true,  true,  true,  true),

  ('admin',     'finance_entries',   true,  true,  true,  true),
  ('treasurer', 'finance_entries',   true,  true,  true,  true),

  ('admin',     'reminder_batches',  true,  false, true,  false),
  ('treasurer', 'reminder_batches',  true,  false, true,  false),

  ('admin',     'audit_log',         true,  false, false, false),

  ('admin',     'league_table_sources', true, true, true, true),
  ('treasurer', 'league_table_sources', true, true, true, true),

  ('admin',     'league_standings',  true,  false, false, false),
  ('coach',     'league_standings',  true,  false, false, false),

  ('admin',     'issued_items',      true,  true,  true,  true),
  ('coach',     'issued_items',      true,  true,  true,  true),

  ('admin',     'player_status_log', true,  true,  false, false),
  ('treasurer', 'player_status_log', true,  false, false, false),
  ('coach',     'player_status_log', true,  true,  false, false),

  ('admin',     'backups',           true,  true,  true,  true),

  ('admin',     'staff',             true,  true,  true,  true)
on conflict (role, table_name) do update set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

alter table role_permissions enable row level security;
drop policy if exists "role_permissions_select" on role_permissions;
create policy "role_permissions_select" on role_permissions for select
  using (current_staff_role() = 'admin');
-- Deliberately no insert/update/delete policy here - changing permissions
-- is a schema change (edit this file and re-run it), not an in-app action,
-- to avoid a logged-in Admin being able to accidentally lock everyone out
-- (including themselves) via the UI.

create or replace function has_permission(p_table text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case p_action
       when 'select' then can_select
       when 'insert' then can_insert
       when 'update' then can_update
       when 'delete' then can_delete
       else false
     end
     from role_permissions
     where role = current_staff_role() and table_name = p_table),
    false
  );
$$;

grant execute on function has_permission(text, text) to authenticated;

-- ---------- Row Level Security ----------
alter table players enable row level security;
alter table payments enable row level security;
alter table tiers enable row level security;
alter table matches enable row level security;
alter table match_squad enable row level security;
alter table inventory_items enable row level security;
alter table issued_items enable row level security;
alter table backups enable row level security;
alter table player_status_log enable row level security;
alter table club_settings enable row level security;
alter table division_labels enable row level security;
alter table notices enable row level security;
alter table fixtures enable row level security;
alter table club_assets enable row level security;
alter table finance_entries enable row level security;
alter table reminder_batches enable row level security;
alter table audit_log enable row level security;
alter table league_table_sources enable row level security;
alter table league_standings enable row level security;
alter table staff enable row level security;

-- Clear out the old open-access policies from before auth existed.
drop policy if exists "Allow all on players" on players;
drop policy if exists "Allow all on payments" on payments;
drop policy if exists "Allow all on tiers" on tiers;
drop policy if exists "Allow all on matches" on matches;
drop policy if exists "Allow all on match_squad" on match_squad;
drop policy if exists "Allow all on inventory_items" on inventory_items;
drop policy if exists "Allow all on issued_items" on issued_items;
drop policy if exists "Allow all on backups" on backups;
drop policy if exists "Allow all on player_status_log" on player_status_log;
drop policy if exists "Allow all on club_settings" on club_settings;

-- players: generic policies driven by role_permissions (see has_permission above)
drop policy if exists "players_select" on players;
create policy "players_select" on players for select
  using (has_permission('players', 'select'));
drop policy if exists "players_insert" on players;
create policy "players_insert" on players for insert
  with check (has_permission('players', 'insert'));
drop policy if exists "players_update" on players;
create policy "players_update" on players for update
  using (has_permission('players', 'update'))
  with check (has_permission('players', 'update'));
drop policy if exists "players_delete" on players;
create policy "players_delete" on players for delete
  using (has_permission('players', 'delete'));

-- payments
drop policy if exists "payments_select" on payments;
create policy "payments_select" on payments for select
  using (has_permission('payments', 'select'));
drop policy if exists "payments_write" on payments;
create policy "payments_write" on payments for insert
  with check (has_permission('payments', 'insert'));
drop policy if exists "payments_update" on payments;
create policy "payments_update" on payments for update
  using (has_permission('payments', 'update'))
  with check (has_permission('payments', 'update'));
drop policy if exists "payments_delete" on payments;
create policy "payments_delete" on payments for delete
  using (has_permission('payments', 'delete'));

-- tiers
drop policy if exists "tiers_select" on tiers;
create policy "tiers_select" on tiers for select
  using (has_permission('tiers', 'select'));
drop policy if exists "tiers_write" on tiers;
create policy "tiers_write" on tiers for insert
  with check (has_permission('tiers', 'insert'));
drop policy if exists "tiers_update" on tiers;
create policy "tiers_update" on tiers for update
  using (has_permission('tiers', 'update'))
  with check (has_permission('tiers', 'update'));
drop policy if exists "tiers_delete" on tiers;
create policy "tiers_delete" on tiers for delete
  using (has_permission('tiers', 'delete'));

-- club_settings (singleton row - no insert/delete policy by design)
drop policy if exists "club_settings_select" on club_settings;
create policy "club_settings_select" on club_settings for select
  using (has_permission('club_settings', 'select'));
drop policy if exists "club_settings_update" on club_settings;
create policy "club_settings_update" on club_settings for update
  using (has_permission('club_settings', 'update'))
  with check (has_permission('club_settings', 'update'));

-- division_labels: full CRUD for whichever roles have Fixtures Post access
drop policy if exists "division_labels_all" on division_labels;
create policy "division_labels_all" on division_labels for all
  using (has_permission('division_labels', 'select'))
  with check (has_permission('division_labels', 'select'));

-- notices: the player-read policy already exists live and is untouched
-- (re-declared here only so this file matches reality). SELECT for staff
-- stays a simple blanket check (every staff member should see the full
-- notice list in the admin app, for management/oversight) - it's only
-- INSERT/UPDATE/DELETE that need to be content-aware, replacing the
-- simpler "any staff role can write anything" policies from an earlier
-- version of this file with real per-row targeting rules:
--   - Admin and Treasurer can post/edit/delete anything, any target.
--   - A Coach can only INSERT a notice targeted at an age group they're
--     actually assigned to in staff_teams (never 'ALL', never someone
--     else's team), and can only UPDATE/DELETE notices they themselves
--     posted - never another coach's.
--   - `posted_by = current_staff_id()` is enforced on INSERT itself (not
--     just trusted from the client) - without this, a coach could
--     otherwise attribute a post to a different staff member, which would
--     also affect who's later allowed to edit/delete it.
drop policy if exists "notices_select_for_players" on notices;
create policy "notices_select_for_players" on notices for select
  using (current_player_id() is not null);

drop policy if exists "notices_select_for_staff" on notices;
create policy "notices_select_for_staff" on notices for select
  using (has_permission('notices', 'select'));

drop policy if exists "notices_insert_for_staff" on notices;
create policy "notices_insert_for_staff" on notices for insert
  with check (
    posted_by = current_staff_id()
    and (
      current_staff_role() in ('admin', 'treasurer')
      or (
        current_staff_role() = 'coach'
        and target_age_group is not null
        and target_age_group <> 'ALL'
        and exists (
          select 1 from staff_teams st
          where st.staff_id = current_staff_id()
          and st.age_group = notices.target_age_group
        )
      )
    )
  );

drop policy if exists "notices_update_for_staff" on notices;
create policy "notices_update_for_staff" on notices for update
  using (
    current_staff_role() in ('admin', 'treasurer')
    or (current_staff_role() = 'coach' and posted_by = current_staff_id())
  )
  with check (
    current_staff_role() in ('admin', 'treasurer')
    or (
      current_staff_role() = 'coach'
      and posted_by = current_staff_id()
      and target_age_group is not null
      and target_age_group <> 'ALL'
      and exists (
        select 1 from staff_teams st
        where st.staff_id = current_staff_id()
        and st.age_group = notices.target_age_group
      )
    )
  );

drop policy if exists "notices_delete_for_staff" on notices;
create policy "notices_delete_for_staff" on notices for delete
  using (
    current_staff_role() in ('admin', 'treasurer')
    or (current_staff_role() = 'coach' and posted_by = current_staff_id())
  );

-- staff_teams: admins manage assignments; a coach may read their own rows
-- (so the notice-posting UI can show them their own teams) but not
-- anyone else's, and can't write to this table at all.
alter table staff_teams enable row level security;

drop policy if exists "staff_teams_admin_all" on staff_teams;
create policy "staff_teams_admin_all" on staff_teams for all
  using (current_staff_role() = 'admin')
  with check (current_staff_role() = 'admin');

drop policy if exists "staff_teams_self_select" on staff_teams;
create policy "staff_teams_self_select" on staff_teams for select
  using (staff_id = current_staff_id());

-- fixtures: select is uniform (admin/treasurer/coach all just need
-- has_permission('fixtures','select') to be true), but insert/update/delete
-- is admin/treasurer only - per-action policies, since permission isn't
-- uniform across all four actions here (unlike the "for all" tables below).
drop policy if exists "fixtures_select" on fixtures;
create policy "fixtures_select" on fixtures for select
  using (has_permission('fixtures', 'select'));
drop policy if exists "fixtures_insert" on fixtures;
create policy "fixtures_insert" on fixtures for insert
  with check (has_permission('fixtures', 'insert'));
drop policy if exists "fixtures_update" on fixtures;
create policy "fixtures_update" on fixtures for update
  using (has_permission('fixtures', 'update'))
  with check (has_permission('fixtures', 'update'));
drop policy if exists "fixtures_delete" on fixtures;
create policy "fixtures_delete" on fixtures for delete
  using (has_permission('fixtures', 'delete'));

-- matches, match_squad, inventory_items, issued_items: permission is uniform
-- across all four actions per role in our matrix, so a single check per
-- table (gated on 'select') covers the whole FOR ALL policy correctly.
drop policy if exists "matches_all" on matches;
create policy "matches_all" on matches for all
  using (has_permission('matches', 'select'))
  with check (has_permission('matches', 'select'));

-- Separate, additive policy so a player's own app (built elsewhere) can
-- read fixtures/results - RLS policies are OR'd together, so this doesn't
-- change or weaken the staff policy above at all. Deliberately simple:
-- any linked player can read every match, with the player app itself
-- filtering down to their own team - replicating age-group matching logic
-- in a security rule would be more fragile than doing it in application code.
drop policy if exists "matches_player_read" on matches;
create policy "matches_player_read" on matches for select
  using (current_player_id() is not null);

drop policy if exists "match_squad_all" on match_squad;
create policy "match_squad_all" on match_squad for all
  using (has_permission('match_squad', 'select'))
  with check (has_permission('match_squad', 'select'));

drop policy if exists "inventory_items_all" on inventory_items;
create policy "inventory_items_all" on inventory_items for all
  using (has_permission('inventory_items', 'select'))
  with check (has_permission('inventory_items', 'select'));

drop policy if exists "club_assets_all" on club_assets;
create policy "club_assets_all" on club_assets for all
  using (has_permission('club_assets', 'select'))
  with check (has_permission('club_assets', 'select'));

drop policy if exists "finance_entries_all" on finance_entries;
create policy "finance_entries_all" on finance_entries for all
  using (has_permission('finance_entries', 'select'))
  with check (has_permission('finance_entries', 'select'));

-- reminder_batches: select + update only (marking a batch sent/dismissed).
-- No insert/delete policy - only create_monthly_reminder_batch() (security
-- definer, run by pg_cron) can create one, deliberately keeping "when a
-- new batch appears" outside of what any logged-in role can trigger by hand.
drop policy if exists "reminder_batches_select" on reminder_batches;
create policy "reminder_batches_select" on reminder_batches for select
  using (has_permission('reminder_batches', 'select'));
drop policy if exists "reminder_batches_update" on reminder_batches;
create policy "reminder_batches_update" on reminder_batches for update
  using (has_permission('reminder_batches', 'update'))
  with check (has_permission('reminder_batches', 'update'));

-- audit_log: select only - nothing writes to this except audit_log_trigger()
-- (security definer), so no insert/update/delete policy is exposed here at all.
drop policy if exists "audit_log_select" on audit_log;
create policy "audit_log_select" on audit_log for select
  using (has_permission('audit_log', 'select'));

-- league_table_sources: full CRUD for whichever roles manage Settings
drop policy if exists "league_table_sources_all" on league_table_sources;
create policy "league_table_sources_all" on league_table_sources for all
  using (has_permission('league_table_sources', 'select'))
  with check (has_permission('league_table_sources', 'select'));

-- league_standings: select only - nothing writes to this except
-- fetch-league-tables (using the service role key), so no
-- insert/update/delete policy is exposed here at all.
drop policy if exists "league_standings_select" on league_standings;
create policy "league_standings_select" on league_standings for select
  using (has_permission('league_standings', 'select'));

drop policy if exists "issued_items_all" on issued_items;
create policy "issued_items_all" on issued_items for all
  using (has_permission('issued_items', 'select'))
  with check (has_permission('issued_items', 'select'));

-- player_status_log: append-only (no update/delete policy by design)
drop policy if exists "player_status_log_select" on player_status_log;
create policy "player_status_log_select" on player_status_log for select
  using (has_permission('player_status_log', 'select'));
drop policy if exists "player_status_log_write" on player_status_log;
create policy "player_status_log_write" on player_status_log for insert
  with check (has_permission('player_status_log', 'insert'));

-- backups: admin only
drop policy if exists "backups_all" on backups;
create policy "backups_all" on backups for all
  using (has_permission('backups', 'select'))
  with check (has_permission('backups', 'select'));

-- staff: admin only
drop policy if exists "staff_all" on staff;
create policy "staff_all" on staff for all
  using (has_permission('staff', 'select'))
  with check (has_permission('staff', 'select'));

grant execute on function create_backup_snapshot(text) to authenticated;
grant execute on function current_staff_role() to authenticated;


-- take an initial snapshot so the Backups tab has something to show right away
select create_backup_snapshot('manual');

-- ---------- Referees (role + fixture appointments + payment log) ----------
-- New staff role: 'referee'. Same shape as every other staff account
-- (invited from Users, logs in with email/password like admin/treasurer/
-- coach) but deliberately the narrowest role in the app - read-only access
-- to the fixtures list and nothing else. Widening the check constraint
-- like this (drop + re-add, NOT VALID) is the same safe pattern already
-- used for notices.category above - existing rows are unaffected since
-- every existing staff row already has a role in the allowed list.
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('admin', 'treasurer', 'coach', 'referee')) not valid;

-- Staff table was previously select-able by Admin only (has_permission
-- only had a row for 'admin'). Treasurer and Coach now also get read-only
-- access - Treasurer needs it to populate the referee dropdown on
-- Fixtures, Coach needs it to see who's been appointed on Matchday. This
-- only exposes id/email/role/invited_at (nothing sensitive) and does NOT
-- change who can invite or remove staff - that stays Admin-only, both in
-- the Users tab (nav) and re-checked server-side in the invite-user Edge
-- Function.
insert into role_permissions (role, table_name, can_select, can_insert, can_update, can_delete) values
  ('treasurer', 'staff', true, false, false, false),
  ('coach',     'staff', true, false, false, false)
on conflict (role, table_name) do update set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

-- Belt-and-braces fix alongside the above: previously the ONLY policy on
-- staff was the blanket has_permission('staff','select') check, which
-- meant even a logged-in Treasurer/Coach/Referee couldn't read their OWN
-- row - the exact query loadRole() runs right after login - unless
-- role_permissions granted them 'staff' select. Adding self-read as an
-- explicit, additive OR condition means every role can always resolve
-- their own account after logging in, regardless of what role_permissions
-- says, without weakening anything (a user could always identify their
-- own role anyway).
drop policy if exists "staff_all" on staff;
create policy "staff_all" on staff for all
  using (has_permission('staff', 'select') or user_id = auth.uid())
  with check (has_permission('staff', 'select'));

-- Referees can only ever read fixtures - no insert/update/delete, no
-- access to anything else in the app (finance, squad, messages, etc. all
-- stay unreachable since no role_permissions row means has_permission
-- returns false by default).
insert into role_permissions (role, table_name, can_select, can_insert, can_update, can_delete) values
  ('referee', 'fixtures', true, false, false, false)
on conflict (role, table_name) do update set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

-- Which referee is appointed to each fixture. Nullable - most fixtures
-- won't have one set until an Admin/Treasurer assigns it. Insert/update
-- rights on fixtures are already Admin/Treasurer-only (see fixtures_update
-- policy above), so assigning a referee is covered by the exact same
-- permission check as editing any other fixture field - no new policy
-- needed on fixtures itself.
alter table fixtures add column if not exists referee_id uuid references staff(id) on delete set null;
create index if not exists fixtures_referee_id_idx on fixtures(referee_id);

-- A default match fee, editable in Settings, used to pre-fill new
-- appointment rows below (still editable per-appointment afterwards).
alter table club_settings add column if not exists default_referee_fee numeric default 0;

-- ---------- referee_appointments (payment log) ----------
-- One row per fixture that's had a referee assigned. This is what the
-- Admin section's "Referee Pay" tab reads from to work out who's owed what
-- for the month - fee_amount starts from club_settings.default_referee_fee
-- but is editable per row (a derby or cup match might carry a different
-- fee), and `paid` is a simple toggle rather than a full ledger.
create table if not exists referee_appointments (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references fixtures(id) on delete cascade,
  referee_id uuid not null references staff(id) on delete cascade,
  fee_amount numeric not null default 0,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (fixture_id)
);

create index if not exists referee_appointments_referee_id_idx on referee_appointments(referee_id);

-- Same treatment as finance_entries: Admin and Treasurer both get full
-- read/write, since this is what determines the month's referee payments
-- and Treasurer already owns the club's financial admin everywhere else
-- in the app (Finance, Subscriptions, Settings).
insert into role_permissions (role, table_name, can_select, can_insert, can_update, can_delete) values
  ('admin',     'referee_appointments', true, true, true, true),
  ('treasurer', 'referee_appointments', true, true, true, true)
on conflict (role, table_name) do update set
  can_select = excluded.can_select,
  can_insert = excluded.can_insert,
  can_update = excluded.can_update,
  can_delete = excluded.can_delete;

alter table referee_appointments enable row level security;
drop policy if exists "referee_appointments_all" on referee_appointments;
create policy "referee_appointments_all" on referee_appointments for all
  using (has_permission('referee_appointments', 'select'))
  with check (has_permission('referee_appointments', 'select'));

-- Keeps the appointments log in sync with fixtures.referee_id, so the app
-- never has to remember to do this in two places:
--   - a referee assigned where none existed before -> insert a log row,
--     fee pre-filled from club_settings.default_referee_fee
--   - the referee on a fixture changed to someone else -> update the
--     existing row's referee_id (fee/paid history for that fixture is
--     preserved rather than duplicated)
--   - the referee removed from a fixture -> delete the log row (nothing
--     to pay for an appointment that no longer exists); the on delete
--     cascade above handles the fixture being deleted outright
create or replace function sync_referee_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_fee numeric;
begin
  if new.referee_id is null then
    delete from referee_appointments where fixture_id = new.id;
    return new;
  end if;

  if old is null or old.referee_id is distinct from new.referee_id then
    select coalesce(default_referee_fee, 0) into default_fee from club_settings where id = 1;
    insert into referee_appointments (fixture_id, referee_id, fee_amount)
      values (new.id, new.referee_id, coalesce(default_fee, 0))
    on conflict (fixture_id) do update set
      referee_id = excluded.referee_id,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists fixtures_sync_referee_appointment on fixtures;
create trigger fixtures_sync_referee_appointment
  after insert or update of referee_id on fixtures
  for each row execute function sync_referee_appointment();

-- ---------- fold referee data into backups (Admin only, same as before) ----------
create or replace function create_backup_snapshot(p_kind text default 'scheduled')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into backups (kind, data)
  values (
    p_kind,
    jsonb_build_object(
      'players', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from players p),
      'payments', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from payments p),
      'tiers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tiers t),
      'matches', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from matches m),
      'match_squad', (select coalesce(jsonb_agg(to_jsonb(ms)), '[]'::jsonb) from match_squad ms),
      'inventory_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from inventory_items i),
      'issued_items', (select coalesce(jsonb_agg(to_jsonb(ii)), '[]'::jsonb) from issued_items ii),
      'player_status_log', (select coalesce(jsonb_agg(to_jsonb(sl)), '[]'::jsonb) from player_status_log sl),
      'club_settings', (select coalesce(jsonb_agg(to_jsonb(cs)), '[]'::jsonb) from club_settings cs),
      'division_labels', (select coalesce(jsonb_agg(to_jsonb(dl)), '[]'::jsonb) from division_labels dl),
      'club_assets', (select coalesce(jsonb_agg(to_jsonb(ca)), '[]'::jsonb) from club_assets ca),
      'finance_entries', (select coalesce(jsonb_agg(to_jsonb(fe)), '[]'::jsonb) from finance_entries fe),
      'reminder_batches', (select coalesce(jsonb_agg(to_jsonb(rb)), '[]'::jsonb) from reminder_batches rb),
      'audit_log', (select coalesce(jsonb_agg(to_jsonb(al)), '[]'::jsonb) from audit_log al),
      'league_table_sources', (select coalesce(jsonb_agg(to_jsonb(lts)), '[]'::jsonb) from league_table_sources lts),
      'league_standings', (select coalesce(jsonb_agg(to_jsonb(ls)), '[]'::jsonb) from league_standings ls),
      'fixtures', (select coalesce(jsonb_agg(to_jsonb(fx)), '[]'::jsonb) from fixtures fx),
      'referee_appointments', (select coalesce(jsonb_agg(to_jsonb(ra)), '[]'::jsonb) from referee_appointments ra),
      'notices', (select coalesce(jsonb_agg(to_jsonb(nt)), '[]'::jsonb) from notices nt)
    )
  )
  returning id into new_id;

  -- prune anything older than 30 days so free-tier storage stays healthy
  delete from backups where created_at < now() - interval '30 days';

  return new_id;
end;
$$;

create or replace function restore_from_snapshot(snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  -- This function bypasses RLS (security definer), so the admin check has
  -- to happen explicitly here rather than relying on table policies.
  select role into caller_role from staff where user_id = auth.uid();
  if caller_role is distinct from 'admin' then
    raise exception 'Only an Admin can restore from a backup.';
  end if;

  -- Children first, then parents, respecting foreign keys. referee_appointments
  -- references fixtures, so it has to go before fixtures on the way out.
  delete from issued_items;
  delete from match_squad;
  delete from payments;
  delete from player_status_log;
  delete from matches;
  delete from inventory_items;
  delete from players;
  delete from tiers;
  delete from division_labels;
  delete from club_assets;
  delete from finance_entries;
  delete from reminder_batches;
  delete from audit_log;
  delete from league_standings;
  delete from league_table_sources;
  delete from referee_appointments;
  delete from fixtures;
  delete from notices;

  -- Parents first, then children, on the way back in.
  insert into tiers
    select * from jsonb_populate_recordset(null::tiers, coalesce(snapshot->'tiers', '[]'::jsonb));
  insert into players
    select * from jsonb_populate_recordset(null::players, coalesce(snapshot->'players', '[]'::jsonb));
  insert into inventory_items
    select * from jsonb_populate_recordset(null::inventory_items, coalesce(snapshot->'inventory_items', '[]'::jsonb));
  insert into matches
    select * from jsonb_populate_recordset(null::matches, coalesce(snapshot->'matches', '[]'::jsonb));
  insert into payments
    select * from jsonb_populate_recordset(null::payments, coalesce(snapshot->'payments', '[]'::jsonb));
  insert into match_squad
    select * from jsonb_populate_recordset(null::match_squad, coalesce(snapshot->'match_squad', '[]'::jsonb));
  insert into issued_items
    select * from jsonb_populate_recordset(null::issued_items, coalesce(snapshot->'issued_items', '[]'::jsonb));
  insert into player_status_log
    select * from jsonb_populate_recordset(null::player_status_log, coalesce(snapshot->'player_status_log', '[]'::jsonb));
  insert into division_labels
    select * from jsonb_populate_recordset(null::division_labels, coalesce(snapshot->'division_labels', '[]'::jsonb));
  insert into club_assets
    select * from jsonb_populate_recordset(null::club_assets, coalesce(snapshot->'club_assets', '[]'::jsonb));
  insert into reminder_batches
    select * from jsonb_populate_recordset(null::reminder_batches, coalesce(snapshot->'reminder_batches', '[]'::jsonb));
  insert into audit_log
    select * from jsonb_populate_recordset(null::audit_log, coalesce(snapshot->'audit_log', '[]'::jsonb));
  insert into league_table_sources
    select * from jsonb_populate_recordset(null::league_table_sources, coalesce(snapshot->'league_table_sources', '[]'::jsonb));
  insert into league_standings
    select * from jsonb_populate_recordset(null::league_standings, coalesce(snapshot->'league_standings', '[]'::jsonb));
  insert into finance_entries
    select * from jsonb_populate_recordset(null::finance_entries, coalesce(snapshot->'finance_entries', '[]'::jsonb));
  insert into fixtures
    select * from jsonb_populate_recordset(null::fixtures, coalesce(snapshot->'fixtures', '[]'::jsonb));
  insert into referee_appointments
    select * from jsonb_populate_recordset(null::referee_appointments, coalesce(snapshot->'referee_appointments', '[]'::jsonb));
  insert into notices
    select * from jsonb_populate_recordset(null::notices, coalesce(snapshot->'notices', '[]'::jsonb));
  -- Restored notices never go to phones (again): mark them as handled for
  -- the Player Portal's hourly push job. Checked by name so this still
  -- works on a database that doesn't have push notifications set up.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notices' and column_name = 'push_sent_at') then
    execute 'update notices set push_sent_at = now() where push_sent_at is null';
  end if;

  if snapshot ? 'club_settings' and jsonb_array_length(coalesce(snapshot->'club_settings', '[]'::jsonb)) > 0 then
    insert into club_settings
      select * from jsonb_populate_recordset(null::club_settings, snapshot->'club_settings')
    on conflict (id) do update set
      sender_email = excluded.sender_email,
      sender_display_name = excluded.sender_display_name,
      reply_to_email = excluded.reply_to_email,
      bank_details = excluded.bank_details,
      invoice_footer_note = excluded.invoice_footer_note,
      default_referee_fee = excluded.default_referee_fee,
      updated_at = excluded.updated_at;
  end if;
end;
$$;

