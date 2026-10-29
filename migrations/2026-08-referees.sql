-- Garlandale FC — Referees migration
--
-- Adds everything needed for the new Referee role, referee appointments on
-- Fixtures, and the Admin "Referee Pay" log:
--   - new staff role: 'referee' (read-only on fixtures)
--   - Treasurer/Coach get read-only access to the staff table (needed for
--     the referee dropdown / Matchday display) — inviting/removing staff
--     stays Admin-only
--   - a fix so every role can always read their own staff row on login
--   - fixtures.referee_id + club_settings.default_referee_fee
--   - the referee_appointments table (the payment log), kept in sync with
--     fixtures.referee_id by a trigger
--   - referee_appointments folded into the existing backup/restore
--     functions
--
-- This file only contains what's NEW since the previous schema.sql — it's
-- safe to run on its own against a database that already has the rest of
-- schema.sql applied. Run it once in the Supabase SQL Editor (Project ->
-- SQL Editor -> New query). Everything here is idempotent (uses `if not
-- exists` / `create or replace` / `on conflict`), so it's also safe to
-- run more than once.
--
-- After running this, redeploy the invite-user Edge Function so it
-- accepts the new role server-side too:
--   supabase functions deploy invite-user

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
