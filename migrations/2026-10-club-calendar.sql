-- ===========================================================================
-- Club calendar (2026-10)
--
-- Adds club events (training, socials, meetings, tournaments, fundraisers,
-- ...) that Admin, Chairman and Treasurer manage in Club Management ->
-- Calendar, and that everyone signed in to the Player Portal can see
-- (guardians and approved supporters), alongside the club's fixtures.
--
--   calendar_categories  - the event categories, with their colours.
--                          Two are built in and can't be deleted:
--                          'Fixture' (colours fixtures from the Fixtures tab)
--                          and 'Other' (where events go when their category
--                          is deleted).
--   calendar_events      - one row per event. A repeating event is several
--                          rows sharing a series_id, so each date can still
--                          be edited or deleted on its own.
--
-- Players never read these tables directly: the Player Portal's
-- get-club-calendar Edge Function reads them with the service-role key.
--
-- Safe to run more than once. Run it in the Supabase SQL Editor.
-- ===========================================================================

-- ---------- who may change the calendar ----------
-- Admin, Chairman and Treasurer. Coaches and referees can view only.
create or replace function can_manage_calendar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_staff_role() in ('admin', 'chairman', 'treasurer'), false);
$$;

grant execute on function can_manage_calendar() to authenticated;

-- ---------- categories ----------
create table if not exists calendar_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null,
  text_color text not null default '#ffffff',
  sort_order int not null default 0,
  is_system text,                 -- 'fixture' or 'other' for the two built-in categories, else null
  created_at timestamptz default now(),
  constraint calendar_categories_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint calendar_categories_color_hex check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint calendar_categories_text_color_hex check (text_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint calendar_categories_system_kind check (is_system is null or is_system in ('fixture', 'other')),
  constraint calendar_categories_system_unique unique (is_system)
);

create unique index if not exists calendar_categories_name_key on calendar_categories (lower(btrim(name)));

insert into calendar_categories (name, color, text_color, sort_order, is_system)
select * from (values
  ('Fixture',    '#241a45', '#ffffff', 0, 'fixture'),
  ('Training',   '#1e7a41', '#ffffff', 1, null),
  ('Social',     '#e8ac2e', '#1c1730', 2, null),
  ('Meeting',    '#5b5470', '#ffffff', 3, null),
  ('Tournament', '#c1443c', '#ffffff', 4, null),
  ('Fundraiser', '#f6d9a8', '#5c3a00', 5, null),
  ('Other',      '#e2dbc9', '#1c1730', 99, 'other')
) as seed(name, color, text_color, sort_order, is_system)
where not exists (select 1 from calendar_categories);

-- ---------- events ----------
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category_id uuid not null references calendar_categories(id) on delete restrict,
  event_date date not null,
  all_day boolean not null default false,
  start_time time,
  end_time time,
  venue text not null default '',
  description text not null default '',
  location_link text,
  location_embed text,
  series_id uuid,                -- shared by every date created from one repeating event
  repeat_rule text,              -- 'weekly' | 'fortnightly' | 'monthly', only set on series rows
  repeat_until date,
  notice_id uuid references notices(id) on delete set null,  -- the Notice Board post, if one was made
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint calendar_events_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint calendar_events_venue_len check (char_length(venue) <= 200),
  constraint calendar_events_description_len check (char_length(description) <= 2000),
  constraint calendar_events_times check (all_day or start_time is not null),
  constraint calendar_events_end_after_start check (end_time is null or start_time is null or end_time > start_time),
  constraint calendar_events_repeat_rule check (repeat_rule is null or repeat_rule in ('weekly', 'fortnightly', 'monthly')),
  -- Same rules as the venue-location fields on fixtures and notices
  -- (src/lib/mapLinks.js): genuine Google Maps addresses only.
  constraint calendar_events_location_link_safe check (
    location_link is null or location_link = '' or (
      char_length(location_link) <= 2000
      and location_link !~ '[[:space:]"''<>`\\]'
      and location_link ~ '^https://(maps\.app\.goo\.gl/.+|goo\.gl/maps/.+|(www\.)?google\.(com|co\.za)/maps([/?#]|$)|maps\.google\.(com|co\.za)/)'
    )
  ),
  constraint calendar_events_location_embed_safe check (
    location_embed is null or location_embed = '' or (
      char_length(location_embed) <= 2000
      and location_embed !~ '[[:space:]"''<>`\\]'
      and location_embed ~ '^https://(www\.)?google\.com/maps/embed(/v1/[a-z]+)?\?.+'
    )
  )
);

create index if not exists calendar_events_date_idx on calendar_events (event_date);
create index if not exists calendar_events_series_idx on calendar_events (series_id) where series_id is not null;

-- Keeps updated_at current, records who created an event, and stops
-- anyone filing an event under the built-in Fixture category (fixtures
-- come from the Fixtures tab, not from here).
create or replace function calendar_events_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from calendar_categories c where c.id = new.category_id and c.is_system = 'fixture') then
    raise exception 'Fixtures are added in the Fixtures tab. Pick a different category for this event.';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_before_write on calendar_events;
create trigger calendar_events_before_write before insert or update on calendar_events
  for each row execute function calendar_events_before_write();

-- ---------- deleting a category ----------
-- Moves the category's events to 'Other', then deletes it, in one step.
-- The two built-in categories can't be deleted.
create or replace function delete_calendar_category(p_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  other_id uuid;
  moved int;
begin
  if not can_manage_calendar() then
    raise exception 'Only an Admin, Chairman or Treasurer can change calendar categories.';
  end if;
  if exists (select 1 from calendar_categories where id = p_id and is_system is not null) then
    raise exception 'This category is built in and can''t be deleted.';
  end if;
  select id into other_id from calendar_categories where is_system = 'other';
  if other_id is null then
    raise exception 'The built-in Other category is missing. Re-run migrations/2026-10-club-calendar.sql.';
  end if;
  update calendar_events set category_id = other_id where category_id = p_id;
  get diagnostics moved = row_count;
  delete from calendar_categories where id = p_id;
  return moved;
end;
$$;

grant execute on function delete_calendar_category(uuid) to authenticated;

-- ---------- row-level security ----------
alter table calendar_categories enable row level security;
alter table calendar_events enable row level security;

-- Any staff member can view the calendar.
drop policy if exists "calendar_categories_select" on calendar_categories;
create policy "calendar_categories_select" on calendar_categories for select
  using (current_staff_id() is not null);

drop policy if exists "calendar_categories_insert" on calendar_categories;
create policy "calendar_categories_insert" on calendar_categories for insert
  with check (can_manage_calendar() and is_system is null);

drop policy if exists "calendar_categories_update" on calendar_categories;
create policy "calendar_categories_update" on calendar_categories for update
  using (can_manage_calendar())
  with check (can_manage_calendar());

-- Deleting goes through delete_calendar_category(); a direct delete is
-- only allowed for a non-built-in category that no event uses.
drop policy if exists "calendar_categories_delete" on calendar_categories;
create policy "calendar_categories_delete" on calendar_categories for delete
  using (can_manage_calendar() and is_system is null);

-- The built-in flag can never be changed from the app.
create or replace function calendar_categories_keep_system()
returns trigger
language plpgsql
as $$
begin
  if new.is_system is distinct from old.is_system then
    raise exception 'The built-in setting of a category can''t be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_categories_keep_system on calendar_categories;
create trigger calendar_categories_keep_system before update on calendar_categories
  for each row execute function calendar_categories_keep_system();

drop policy if exists "calendar_events_select" on calendar_events;
create policy "calendar_events_select" on calendar_events for select
  using (current_staff_id() is not null);

drop policy if exists "calendar_events_insert" on calendar_events;
create policy "calendar_events_insert" on calendar_events for insert
  with check (can_manage_calendar());

drop policy if exists "calendar_events_update" on calendar_events;
create policy "calendar_events_update" on calendar_events for update
  using (can_manage_calendar())
  with check (can_manage_calendar());

drop policy if exists "calendar_events_delete" on calendar_events;
create policy "calendar_events_delete" on calendar_events for delete
  using (can_manage_calendar());
