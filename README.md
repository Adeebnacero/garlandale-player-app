# Garlandale FC — Club Management App

A single-user (Chairman-only, no login) club management app: player roster,
age groups, subscription tracking, compliance status, matchday squad
selection with a printable official team sheet, kit/stock tracking, and
WhatsApp/SMS message triggers — backed by a free Supabase (Postgres)
database instead of local in-app storage.

## 1. Create your free Supabase project

1. Go to https://supabase.com and sign up (free tier).
2. Click **New project**. Pick any name/region, set a database password
   (you won't need it day-to-day — just keep it somewhere safe).
3. Wait ~2 minutes for the project to spin up.

## 2. Create the tables

1. In your Supabase project, open **SQL Editor** (left sidebar).
2. Click **New query**, paste in the entire contents of `schema.sql` from
   this folder, and click **Run**.
3. This creates `players`, `payments`, `matches`, `match_squad`,
   `inventory_items`, and `issued_items` tables, sets up permissive access
   policies (since there's no login screen), and adds a few sample players
   and stock items so you can see the app working immediately. Delete the
   samples from the Squad and Kit tabs once you're ready to add real data.

## 3. Get your API keys

1. In Supabase, go to **Project Settings -> API**.
2. Copy the **Project URL** and the **anon / public** key (NOT the
   `service_role` key — that one must never be used in browser code).

## 4. Configure the app

1. In this project folder, copy `.env.example` to a new file called `.env`.
2. Fill in the two values from step 3:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
3. `.env` is only ever read locally / at build time — it won't be committed
   if you use the included `.gitignore` pattern (add `.env` to it if you
   set up git).

## 5. Install and run

```bash
npm install
npm run dev
```

This opens the app at `http://localhost:5173`. Any changes you make (adding
players, logging payments, editing details) now save straight to your
Supabase database, not just to your browser.

## 6. Put it online (optional, still free)

Once it works locally, you can deploy it for free on **Vercel** or
**Netlify**:
1. Push this folder to a GitHub repo.
2. Import the repo on vercel.com or netlify.com.
3. Add the same two environment variables (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`) in the deployment platform's settings.
4. Deploy — you'll get a permanent URL you can bookmark and use from any
   device, no install required.

## What's in this version

- **New: automatic birthday notices** — every day at 07:00 Cape Town time, a
  scheduled database job checks for any player whose birthday falls today
  and posts one Notice Board entry to their age group ("It's {name}'s
  birthday today! Let's all join in and wish them a Happy Birthday..."). It
  runs on the database itself (not triggered by anyone opening the app), so
  it fires even if no one logs in that day, and it isn't limited by a
  coach's own team assignment. Birthday notices auto-expire after ~48
  hours (cleaned up by the job itself, and hidden from the board sooner on
  the client side too), so the board doesn't fill up with old ones.
  **If you already have this app deployed**, re-run `schema.sql` in the
  Supabase SQL Editor to pick up the new `create_birthday_notices()`
  function, its cron schedule, and the small `notices` table changes it
  needs (a `related_player_id` column, and `birthday` added as a valid
  notice category).
- **New: notice targeting + coach team assignments** — a notice can now be
  aimed at one specific age group instead of always going to everyone.
  - **Users tab**: assign a coach to one or more teams (multi-select
    checklist). Admin/Treasurer aren't restricted at all.
  - **Notice Board**: a new "Target" field — Admin/Treasurer can pick any
    age group or "All players"; a Coach only ever sees their own assigned
    team(s) in that dropdown, and gets a clear message if they don't have
    one assigned yet.
  - **The real security boundary is in the database, not the dropdown** -
    even if the UI had a bug, Postgres itself rejects a coach's attempt to
    post outside their assigned team(s), reassign a post to a different
    target on edit, or touch another coach's notice.
  - **Replaces the simpler notices write policy from last time**: that one
    was a blanket "any of admin/treasurer/coach can write anything" check;
    this one is genuinely content-aware (per-row, per-role). If you'd
    already run the previous notices migration, this one supersedes it.
  - Threaded the logged-in user's own `staff.id` through the app
    (previously only their `role` was tracked) - needed so a notice can
    correctly record who posted it.
  - **Caught two real bugs while building this**: (1) my first version of
    the update policy let a coach silently retarget their own notice to
    "All players" or someone else's team when editing it - fixed to
    re-validate the same ownership rule on update as on insert. (2) the
    Notice Board UI referenced `role`/`staffId`/`staffTeams` without
    actually declaring them as props on `MessagesView` - would have been a
    runtime crash the moment anyone opened that tab; caught by the
    project's own typecheck before it ever shipped.

- **New: Notice Board, folded into Messages** — a sub-nav toggle
  ("Player Messages" / "Notice Board") on the Messages tab. Post
  announcements or training notices, pin the important ones to the top,
  edit or delete anytime. Admin, Treasurer, and Coach can all post.
  Read side already existed (built for the player app in another thread);
  this closes the gap where posting only worked via the Supabase
  Dashboard's Table Editor as a stopgap.
  - Reconciled `schema.sql` with the `notices` table that was already live
    (created directly for the player app's read side) - added here with
    `if not exists` so this file is a true reflection of what's deployed,
    same housekeeping done for a few other tables earlier.
  - Added `posted_by_email`, auto-filled by a trigger from whoever's
    actually logged in (not client-supplied, same reasoning as the audit
    log). The trigger only fills it in when it's missing, so restoring a
    backup preserves each notice's real original poster instead of
    overwriting all of them with whoever happens to run the restore.
  - Added a `category` check constraint (`announcement`/`training`) as
    `NOT VALID` - applies to all new writes immediately without erroring
    on any pre-existing data; run `alter table notices validate constraint
    notices_category_check;` separately once you've confirmed existing
    rows are clean, if you want full historical validation too.

- **"Create from Fixtures" panel on Matchday is now collapsible** —
  collapsed by default (shows a quick count of how many fixtures are in
  the current window), click to expand. No more scrolling past it to get
  to squad selection and team sheet printing.
- **New: manually add a fixture** — not every fixture necessarily comes
  from the federation spreadsheet (friendlies, cup fixtures, etc.). The
  Fixtures tab now has an "+ Add fixture" button, and **every** fixture row
  (imported or manual) is clickable to edit or delete. A manually-added
  fixture flows through everywhere fixtures already work - Fixtures Post's
  poster/PDF selection, and Matchday's "Create from Fixtures" panel - since
  it's stored in the exact same table.
  - Editing deliberately leaves an imported fixture's poster-friendly label
    and its link back to the spreadsheet's division untouched - only the
    practical fields (opponent, date, time, venue, home/away, age group)
    are editable, so fixing a kickoff time can't accidentally break
    re-import matching or silently degrade a nicer poster label back to a
    plain age-group code.

- **New: create Matchday entries straight from Fixtures** — a "Create from
  Fixtures" panel on the Matchday tab shows upcoming fixtures (defaults to
  the next 7 days, adjustable up to 30 days or "all upcoming"). Select
  which ones to turn into Matchday entries: opponent, date, time, venue,
  and age group fill in automatically; referee, coach, captain, comments,
  and squad selections all stay blank, exactly like starting one manually.
  - Selecting a fixture that already has a linked entry **refreshes** its
    basic details (in case the time/venue changed) without touching
    anything you've since filled in - squad selections, results, referee
    info, etc. are all left alone.
  - `matches` now has a `fixture_id` column linking back to its source
    fixture, with a uniqueness guarantee (at most one Matchday entry per
    fixture).
  - **Player app groundwork**: added a separate, additive database
    permission so a player's own account (once the other app reads it) can
    see match fixtures/results - deliberately simple (any linked player
    sees all matches), with team-filtering left to the player app itself
    rather than replicated as a fragile security rule.

- **Fixture data is now shared, not trapped inside Fixtures Post** — a new
  **Fixtures** tab (Admin/Treasurer/Coach can view; only Admin/Treasurer
  can import) has the spreadsheet upload and a full table view of every
  imported fixture. Fixtures Post no longer imports anything itself - it
  now selects from this shared list (all upcoming fixtures checked by
  default, uncheck any you don't want on this week's poster/PDF). The
  manual paste-your-own-fixtures text box is gone entirely, per the call to
  fully replace it rather than keep it as a fallback.
  - Re-importing an overlapping date range updates existing fixtures
    (in case a time or venue genuinely changed) instead of creating
    duplicates.
  - The "teach it once" division mapping now asks for **two** things
    instead of one: the poster-friendly label (as before) and the fixture's
    **real squad age group** - this is what will let the (separate) player
    app show a player only their own team's fixtures, matching them
    against real roster data rather than a display-only label.
  - **Housekeeping**: found and fixed real drift between this file and the
    actual live database - several tables that were already live
    (`reminder_batches`, `audit_log`, `league_table_sources`,
    `league_standings`, `match_squad.goals/assists`) were missing from this
    local copy of `schema.sql`. Reconstructed and verified against the
    real database structure before adding anything new, so this file is
    now a true reflection of what's actually deployed.

- **Squad & Subscriptions** — same as before: roster, age groups, payment
  ledgers, and the green/amber/red compliance indicator.
- **Federation reg. no** — each player now has a `reg_no` field for the
  number issued by the football association once they're registered. It's
  optional until then (shown as "Pending federation number"), but the
  database won't allow two players to share the same number once one is
  assigned.
- **Matchday** — create a fixture, build a Starting XI + up to 9 subs from
  the relevant age group, and click "Print team sheet" to generate a
  print-ready copy of the official league team sheet (Cape Town Tygerberg
  LFA format), pre-filled with your players, jersey numbers, and reg
  numbers. The referee/score/signature sections are left blank for matchday,
  as they always are on the paper original.
- **Kit & Stock** — track inventory (jerseys, tracksuits, etc.) and what's
  currently issued to which player, with stock levels adjusting
  automatically as you issue and return items.
- **Messages** — WhatsApp/SMS link generation, unchanged from before.

## Club calendar (October 2026)

A **Calendar** tab (after Fixtures) shows club events and fixtures in a week, month or year view. Admin, Chairman and Treasurer can add, edit and delete events and manage the categories; coaches and referees can view it. Everything on it also appears in the Player Portal's Club calendar, for every guardian and approved supporter.

**Setting it up:** run `migrations/2026-10-club-calendar.sql` in the Supabase SQL Editor (safe to run more than once), then deploy the Player Portal's `get-club-calendar` Edge Function.

- **Fixtures** come from the Fixtures tab, plus Matchday entries that weren't created from a fixture (friendlies). They're read-only here; change them in Fixtures or Matchday.
- **Repeating events** (every week, every 2 weeks or every month, up to an Until date) are saved as one row per date, so each date can still be edited or deleted on its own, or together with every later date.
- **Categories** can be renamed, recoloured, added and deleted. Deleting one moves its events to Other. Fixture and Other are built in and can't be deleted.
- **Notice Board:** adding, changing or deleting an event can also post a notice to everyone, which shows the unread badge in the Player Portal.
- **Not yet in backups:** the two calendar tables (`calendar_categories`, `calendar_events`) aren't included in Backups yet.

## Urgent notices and phone notifications (October 2026)

The Player Portal sends new notices to phones that have notifications on, at five past each hour from 7am to 9pm. In **Messages → Notice Board**, the notice form now has an **Urgent** tick box: urgent notices also go out between 9pm and 7am, at the next five past. Admin, Treasurer and coaches (for their own teams) can tick it.

**Setting it up:** run `migrations/2026-10-push-notifications.sql` in the Supabase SQL Editor (safe to run more than once), after the Player Portal's `0006_notice_pushes.sql`. Then deploy this app.

- **When it goes out:** the form shows when phones will get the notice if you save now (for example "tomorrow at 07:05", or "at 22:05" with Urgent ticked). The Notice Board list shows "To phones at …" under notices that haven't gone out yet, and an Urgent tag.
- **Edits don't re-send:** once a notice has gone to phones, the Urgent box is replaced by a note, and saving changes won't notify phones again. The database also stops anyone signed in from making a notice go out twice.
- **Backups:** restoring a backup never sends notices to phones, and backups made before notifications existed still restore.

## In-app player messages (October 2026, in progress)

Private messages to individual players, sent from **Messages → Player Messages** and read by their guardians in the Player Portal (side panel → Messages). Unlike notices they're personal, so they can include things like a player's balance. Being built in four stages: the database (done), the Send in app button and history here, the Messages page in the Player Portal, then phone notifications.

**Stage 1, the database:** run `migrations/2026-10-player-messages.sql` in the Supabase SQL Editor (safe to run more than once). Nothing changes on screen yet.

- **Who:** Admin, Chairman and Treasurer can send, see the history and withdraw a send. Coaches and referees can't see these, like the rest of Player Messages.
- **Sending** is all-or-nothing through one checked database function: up to 500 players and 1000 characters per message.
- **Kept for 90 days**, then removed by a daily job. Not included in Backups; restoring a backup clears them.

## A note on the team sheet

The printable sheet opens in a new browser tab/window and calls the browser's
own print dialog — no PDF library involved. If your browser blocks the popup,
just allow pop-ups for this site once. The GS/YC/RC/INJ columns, signatures,
and substitution boxes are intentionally left blank, since those are filled
in by hand on the day.

## A note on security

There's no login screen by design — this is built for a single trusted user
(the Chairman) rather than multiple staff accounts. That means anyone who
has your app's URL *and* both env values could read/write the data — there's
no per-user lock. Keep the `.env` values and (if deployed) the app URL
private, the same way you'd treat a shared spreadsheet link. If down the
line you want specific staff to log in with their own accounts and
permissions, Supabase supports that (Auth + refined RLS policies) — just
let me know and that can be layered on top of this without starting over.
