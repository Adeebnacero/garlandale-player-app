-- 0006_notice_pushes.sql
--
-- Push notifications, step 2: the hourly notice job.
--
--   notices.urgent        - set by the urgent tick box (Club Management,
--                           step 3). Urgent notices still wait for the next
--                           hourly run, but are sent during quiet hours.
--   notices.push_sent_at  - when the hourly job handled this notice. Null
--                           = not yet. Every EXISTING notice is stamped
--                           below, so turning this on never pushes old news.
--
--   Vault secret push_cron_secret - lets pg_cron prove to the
--                           send-notice-pushes function that it's the one
--                           calling. Generated here; copy it into the
--                           function's secrets (see README).
--
--   cron job garlandale-hourly-notice-pushes - five past every hour. Quiet
--                           hours are decided inside the function, so the
--                           schedule itself never needs changing.
--
-- Safe to run more than once: the backfill only happens the first time
-- the columns are added, and the secret/job are only created if missing.

-- ---------- Columns (+ backfill on first run only) ----------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notices' and column_name = 'push_sent_at'
  ) then
    alter table public.notices add column push_sent_at timestamptz;
    -- Everything already on the board counts as handled.
    update public.notices set push_sent_at = coalesce(posted_at, now());
  end if;
end $$;

alter table public.notices add column if not exists urgent boolean not null default false;

comment on column public.notices.urgent is
  'Urgent notices are also pushed during quiet hours (21:00-07:00 SA time).';
comment on column public.notices.push_sent_at is
  'When the hourly push job handled this notice; null = not yet.';

-- The hourly job only ever looks for the handful not yet handled.
create index if not exists notices_push_pending_idx
  on public.notices (posted_at) where push_sent_at is null;

-- ---------- Shared secret for pg_cron -> send-notice-pushes ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'push_cron_secret',
      'Shared secret: pg_cron calls send-notice-pushes with this (x-cron-secret header)'
    );
  end if;
end $$;

-- ---------- Hourly job ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'garlandale-hourly-notice-pushes') then
    perform cron.unschedule('garlandale-hourly-notice-pushes');
  end if;
end $$;

select cron.schedule(
  'garlandale-hourly-notice-pushes',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://hfpmlrrunlttiekfdjdz.supabase.co/functions/v1/send-notice-pushes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
