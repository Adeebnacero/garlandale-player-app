Garlandale FC Player Portal — COMPLETE build (notice targeting by age group)
================================================================================

PUSH NOTIFICATIONS - STEP 2 OF 3: HOURLY NOTICES (October 2026)
--------------------------------------------------------------------------------
New notices are now pushed automatically, at five past every hour:
  - Each person gets ONE notification per run covering all their new
    notices (title + short preview for one; "3 new club notices" for more).
  - Quiet hours 21:00-07:00 Cape Town time: only urgent notices go out; the
    rest arrive at 07:05 (including that morning's birthday notices).
  - Who gets what is exactly who sees it on the notice board: age groups
    for guardians/players; "Also show to supporters" (never birthdays)
    for approved supporters.
  - Existing notices are never pushed. A notice still waiting after 24
    hours is marked handled without a notification.
  - Urgent: notices.urgent exists now; the tick box arrives in Club
    Management with step 3.

To switch it on:
  1. Run supabase/migrations/0006_notice_pushes.sql in the SQL Editor.
     (Adds notices.urgent + notices.push_sent_at, stamps every existing
     notice as handled, creates a Vault secret and the hourly cron job.)
  2. Copy the secret it made into the function's secrets:
       select decrypted_secret from vault.decrypted_secrets
       where name = 'push_cron_secret';
       supabase secrets set PUSH_CRON_SECRET=<that value>
  3. Deploy from this repo folder (so supabase/config.toml switches the
     login check off for this one function - cron can't send a login; it
     sends the secret instead):
       supabase functions deploy send-notice-pushes
  4. Deploy this app as usual (full rebuild). Offline cache is now v16;
     the Notifications card now explains the hourly / quiet-hours timing.
  5. Test: post a notice for your own child's age group (or everyone)
     between 07:00 and 20:00, then either wait for five past or run the
     job now in the SQL Editor:
       do $$ declare c text; begin
         select command into c from cron.job
         where jobname = 'garlandale-hourly-notice-pushes';
         execute c;
       end $$;
     Each run logs a summary (notices, people, sent, removed, failed) under
     Edge Functions > send-notice-pushes > Logs.

Files: supabase/functions/send-notice-pushes/ (new),
supabase/functions/_shared/notice-push.js (+ test, new - the rules),
supabase/functions/_shared/webpush.js (batch sending), supabase/config.toml,
supabase/migrations/0006_notice_pushes.sql, push.js (card wording),
service-worker.js (v16).

PUSH NOTIFICATIONS - STEP 1 OF 3: PLUMBING (October 2026)
--------------------------------------------------------------------------------
Profile now has a Notifications card: turn notifications on for this
phone, send yourself a test, turn them off. Works for guardians, players
and supporters. Nothing is sent automatically yet - step 2 adds the hourly
notice job (07:00-21:00, urgent notices any time).

To switch it on:
  1. On your own computer (needs Node), make the club's key pair ONCE:
       npx web-push generate-vapid-keys
     Keep the private key secret - never put it in the app's code or git.
     Don't regenerate it later: every phone would have to turn
     notifications on again.
  2. Store the keys as Supabase secrets:
       supabase secrets set VAPID_PUBLIC_KEY=<public key> \
         VAPID_PRIVATE_KEY=<private key> \
         VAPID_SUBJECT=mailto:<club email address>
  3. Run supabase/migrations/0005_push_subscriptions.sql in the Supabase
     SQL Editor (creates the push_subscriptions table).
  4. Deploy the two new functions:
       supabase functions deploy push-subscription
       supabase functions deploy send-test-push
  5. Deploy this app as usual (full rebuild below). The offline cache is
     now v15.
  6. Test: Android - open the site in Chrome, Profile > Turn on
     notifications > Send a test notification. iPhone - add the app to the
     Home Screen first, open it from the icon, then the same.

Files: push.js (new), service-worker.js (push + tap handling),
icons/badge-96.png (new, status-bar icon), profile.html, home.html
(once-a-day re-save while on), page-shared.js (sign-out removes this
device), styles.css (Notifications card),
supabase/functions/_shared/webpush.js (+ webpush.test.js),
supabase/functions/push-subscription/, supabase/functions/send-test-push/,
supabase/migrations/0005_push_subscriptions.sql.

CLUB CALENDAR (October 2026)
--------------------------------------------------------------------------------
New screen: Club calendar (calendar.html), in the menu under Payment history
on Home (and in the same place in the menu on every other screen). Week,
month and year views of club events and every Garlandale FC fixture. The
same for every guardian and approved supporter.

To switch it on:
  1. Run migrations/2026-10-club-calendar.sql from the Club Management repo
     in the Supabase SQL Editor (it creates the calendar tables).
  2. supabase functions deploy get-club-calendar
  3. Deploy this app as usual. The offline cache is now v13, so phones pick
     up the new screen.

Files: calendar.html, calendar.js, styles.css (Club calendar section),
supabase/functions/get-club-calendar/index.ts,
supabase/functions/_shared/calendar.js (+ calendar.test.js), and the menu
item added to home, fixtures, notices, profile, shop and loyalty.

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. Run the new migration in Supabase SQL Editor:
   notice_targeting_migration.sql (separate download, not part of this zip)
4. Deploy the two changed functions:
     supabase functions deploy get-my-notices
     supabase functions deploy get-my-notice-count
   (all other functions are unchanged this round)
5. git add -A && git commit -m "Filter notices by age group targeting" && git push

WHAT'S NEW THIS ROUND (player-app side)
- Notices can now be targeted at ONE specific age group instead of
  always being visible to everyone. A notice with no target (or
  target 'ALL') still shows to every player - so everything posted so
  far keeps working exactly as before.
- get-my-notices and get-my-notice-count both now filter to: notices
  meant for everyone, OR notices matching the player's own computed
  age group. The unread badge count is now accurate to what a player
  can actually see, not inflated by notices meant for other teams.
- No changes needed to notices.html, home.html's training tile, or the
  drawer badge display logic - they already just render whatever the
  (now correctly filtered) API response contains.

WHAT STILL NEEDS BUILDING (admin-app side - see the handover doc)
This round's real work is mostly on the OTHER side of the system - the
admin app needs a real UI for:
  1. Assigning coaches to one or more teams (age groups)
  2. Letting staff post a notice targeted at a specific group (coaches:
     only their own team(s); admins: any group or "All players")
This is all covered in notice-targeting-handover.md (separate
download) - hand that to whoever's working on the admin app.

IMPORTANT: the actual security enforcement (a coach can't post outside
their assigned team, can't use "All") is already done at the database
level via RLS policies in the migration - the admin-app UI just needs
to present sensible choices, it isn't what's keeping this secure.

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html,
  loyalty.html, accept-invite.html
  cache.js, config.js, styles.css, manifest.json, service-worker.js
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/           (+ billing.js, rate-limit.js)
  supabase/functions/get-my-profile/           (+ billing.js, rate-limit.js)
  supabase/functions/update-my-profile/        (+ rate-limit.js)
  supabase/functions/get-my-fixtures/          (+ billing.js, rate-limit.js)
  supabase/functions/get-my-notices/           (+ billing.js [new], rate-limit.js) - UPDATED
  supabase/functions/mark-notice-read/         (+ rate-limit.js)
  supabase/functions/get-my-notice-count/      (+ billing.js [new], rate-limit.js) - UPDATED
  supabase/functions/get-my-active-status/     (+ rate-limit.js)
  supabase/functions/get-my-loyalty/           (+ rate-limit.js)
