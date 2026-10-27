-- 0005_push_subscriptions.sql
--
-- Push notifications, step 1: one row per device that has turned
-- notifications on. A guardian with a phone and a tablet has two rows.
--
-- Only the Edge Functions touch this table (with the service-role key):
--   push-subscription  - saves / removes the caller's own device
--   send-test-push     - sends a test to the caller's own devices
-- so RLS is switched on with NO policies: nothing can read or write it
-- with the public anon key or a user's own login.
--
-- endpoint is unique: if a different person signs in on the same phone and
-- turns notifications on, the row moves to them rather than the phone
-- getting both people's notifications.
--
-- Rows go automatically when an account is deleted (on delete cascade),
-- when someone signs out (the app removes its own row), and when a push
-- service says the device is gone (send code deletes it).

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text not null default '',
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),  -- last time the app re-saved it
  last_sent_at  timestamptz,                         -- last successful push
  failure_count integer not null default 0           -- consecutive failed sends
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (auth_user_id);

alter table public.push_subscriptions enable row level security;

comment on table public.push_subscriptions is
  'Web Push subscriptions, one per device. Service-role access only (Edge Functions).';
