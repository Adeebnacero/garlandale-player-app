Garlandale FC Player Portal — COMPLETE build (notice targeting by age group)
================================================================================

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
