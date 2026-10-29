-- ===========================================================================
-- Push notifications: Club Management side (2026-10)
--
-- The Player Portal's migration 0006_notice_pushes.sql added
-- notices.urgent and notices.push_sent_at and the hourly push job. This
-- file makes two fixes on this side, so backups keep working with them:
--
--   1. notices.urgent becomes nullable (null = not urgent). Backups taken
--      before 0006 have no `urgent` field, and restoring one failed on the
--      NOT NULL constraint.
--   2. restore_from_snapshot() marks every restored notice as already
--      handled (push_sent_at), so restoring a backup never sends phones
--      notices again.
--   3. A signed-in user can't clear push_sent_at to make a notice go to
--      phones a second time (trigger keep_notice_push_sent_at).
--
-- schema.sql has the same change. Safe to run more than once, and safe on
-- a database without push notifications (both steps check first).
-- ===========================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notices' and column_name = 'urgent') then
    alter table public.notices alter column urgent drop not null;
  end if;
end $$;

-- ---------- Don't let a signed-in user un-send a notice ----------
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

grant execute on function restore_from_snapshot(jsonb) to authenticated;
