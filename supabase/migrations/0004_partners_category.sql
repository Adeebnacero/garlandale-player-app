-- 0004_partners_category.sql
--
-- Adds a `category` column to public.partners so the loyalty page can
-- render two independent tile groups ("Supported by" and "Powered by")
-- from the same table, instead of one flat list.
--
-- Existing rows are backfilled to 'supported' so current behaviour
-- (everything shown under "Supported by") is unchanged until someone
-- adds/edits rows to be 'powered' instead.

alter table public.partners
  add column if not exists category text not null default 'supported';

alter table public.partners
  add constraint partners_category_check
  check (category in ('supported', 'powered'));

-- Backfill is implicit via the column default above for any pre-existing
-- rows created before this migration ran (default applies to existing
-- rows on ALTER TABLE ADD COLUMN in Postgres).

comment on column public.partners.category is
  'Which loyalty-page tile group this partner appears under: supported or powered.';
