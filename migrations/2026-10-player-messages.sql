-- ===========================================================================
-- In-app player messages (2026-10), stage 1: the database
--
-- Private messages from Messages -> Player Messages to individual players,
-- read by their guardians in the Player Portal (side panel -> Messages).
-- Unlike notices, these are personal (e.g. "{first_name}, your balance is
-- {balance}"), so each one belongs to ONE player and is never shown on the
-- shared Notice Board.
--
--   player_message_batches - one row per "Send in app": who sent it, when,
--                            the template as written (with {placeholders})
--                            and how many players it went to. This is the
--                            sent-history list in Club Management.
--   player_messages        - one row per player per send, holding the
--                            filled-in text that player's guardians see,
--                            and when it was first read.
--
-- Who can do what:
--   - Admin, Chairman and Treasurer send, see the history and withdraw a
--     send. Coaches and referees can't see these at all: like the rest of
--     Player Messages they can show balances and compliance.
--   - Sending only goes through send_player_messages(), so a send is
--     all-or-nothing and always checked. There's no direct insert/update.
--   - Guardians never read these tables directly: the Player Portal's
--     Edge Functions do, with the service-role key (stage 3).
--
-- Messages are kept for 90 days, then removed by a daily job.
-- Deleting a player removes their messages. Not included in Backups:
-- restoring a backup clears them (they're short-lived by design).
--
-- Needs the Player Portal's guardian_players table (its migration 0001).
-- Safe to run more than once. Run it in the Supabase SQL Editor.
-- ===========================================================================

-- ---------- who may send ----------
create or replace function can_send_player_messages()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_staff_role() in ('admin', 'chairman', 'treasurer'), false);
$$;

grant execute on function can_send_player_messages() to authenticated;

-- ---------- tables ----------
create table if not exists player_message_batches (
  id uuid primary key default gen_random_uuid(),
  template_id text,                          -- e.g. 'payment_reminder', 'custom'
  template_text text not null,               -- as written, with {placeholders}
  recipient_count int not null,
  sent_by uuid references staff(id) on delete set null,
  sent_by_email text not null default '',
  created_at timestamptz not null default now(),
  constraint player_message_batches_template_id_len check (template_id is null or char_length(template_id) <= 40),
  constraint player_message_batches_text_len check (char_length(btrim(template_text)) between 1 and 1000),
  constraint player_message_batches_count check (recipient_count between 1 and 500)
);

create table if not exists player_messages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references player_message_batches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  body text not null,                        -- filled in for this player
  created_at timestamptz not null default now(),
  read_at timestamptz,                       -- first opened by any of the player's guardians
  constraint player_messages_body_len check (char_length(btrim(body)) between 1 and 1000),
  constraint player_messages_one_per_send unique (batch_id, player_id)
);

create index if not exists player_messages_player_idx on player_messages (player_id, created_at desc);
create index if not exists player_message_batches_created_idx on player_message_batches (created_at desc);

-- ---------- sending ----------
-- p_messages: [{ "player_id": "...", "body": "filled-in text" }, ...]
-- The app fills the placeholders per player (it already does for WhatsApp
-- and SMS); this checks everything and saves the whole send in one go.
-- Returns the new batch id.
create or replace function send_player_messages(p_template_id text, p_template_text text, p_messages jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  new_batch uuid;
  me_id uuid;
  me_email text;
begin
  if not can_send_player_messages() then
    raise exception 'Only an Admin, Chairman or Treasurer can send player messages.';
  end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'Nothing to send.';
  end if;
  n := jsonb_array_length(p_messages);
  if n = 0 then
    raise exception 'Choose at least one player.';
  end if;
  if n > 500 then
    raise exception 'That''s more than 500 players in one go. Send it in smaller groups.';
  end if;
  if p_template_text is null or char_length(btrim(p_template_text)) = 0 then
    raise exception 'Write a message first.';
  end if;
  if char_length(p_template_text) > 1000 then
    raise exception 'Messages can be up to 1000 characters.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_messages) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'player_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(e->'body') is distinct from 'string'
  ) then
    raise exception 'Each message needs a player and some text.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_messages) e
    where char_length(btrim(e->>'body')) = 0 or char_length(e->>'body') > 1000
  ) then
    raise exception 'Each message must have some text, up to 1000 characters.';
  end if;
  if (select count(distinct (e->>'player_id')::uuid) from jsonb_array_elements(p_messages) e) <> n then
    raise exception 'A player is in this send twice.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_messages) e
    where not exists (select 1 from players p where p.id = (e->>'player_id')::uuid)
  ) then
    raise exception 'One of these players no longer exists. Refresh and try again.';
  end if;

  select id, coalesce(email, '') into me_id, me_email from staff where user_id = auth.uid();

  insert into player_message_batches (template_id, template_text, recipient_count, sent_by, sent_by_email)
  values (nullif(btrim(coalesce(p_template_id, '')), ''), p_template_text, n, me_id, coalesce(me_email, ''))
  returning id into new_batch;

  insert into player_messages (batch_id, player_id, body)
  select new_batch, (e->>'player_id')::uuid, e->>'body'
  from jsonb_array_elements(p_messages) e;

  return new_batch;
end;
$$;

grant execute on function send_player_messages(text, text, jsonb) to authenticated;

-- ---------- who will actually get it ----------
-- Of these players, the ones with at least one Player Portal login linked.
-- Club Management can't read guardian_players itself (it's private to each
-- guardian), so the "12 of 15 have the app" check before sending uses this.
create or replace function player_message_reach(p_player_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not can_send_player_messages() then
    raise exception 'Only an Admin, Chairman or Treasurer can send player messages.';
  end if;
  return query
    select distinct gp.player_id
    from guardian_players gp
    where gp.player_id = any(coalesce(p_player_ids, '{}'::uuid[]));
end;
$$;

grant execute on function player_message_reach(uuid[]) to authenticated;

-- ---------- row-level security ----------
alter table player_message_batches enable row level security;
alter table player_messages enable row level security;

drop policy if exists "player_message_batches_select" on player_message_batches;
create policy "player_message_batches_select" on player_message_batches for select
  using (can_send_player_messages());

drop policy if exists "player_messages_select" on player_messages;
create policy "player_messages_select" on player_messages for select
  using (can_send_player_messages());

-- Withdrawing a send deletes the batch; its messages go with it. No insert
-- or update policies: sending is only through send_player_messages().
drop policy if exists "player_message_batches_delete" on player_message_batches;
create policy "player_message_batches_delete" on player_message_batches for delete
  using (can_send_player_messages());

-- ---------- keep 90 days ----------
create or replace function purge_old_player_messages()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from player_message_batches where created_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Only the scheduled job runs this. Supabase grants new functions to anon
-- and authenticated directly, so those are revoked by name as well.
revoke execute on function purge_old_player_messages() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function purge_old_player_messages() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function purge_old_player_messages() from authenticated;
  end if;
end $$;

-- Daily at 01:30 UTC = 03:30 Cape Town.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-purge-player-messages') then
    perform cron.unschedule('garlandale-purge-player-messages');
  end if;
end $$;

select cron.schedule(
  'garlandale-purge-player-messages',
  '30 1 * * *',
  $$select purge_old_player_messages();$$
);
