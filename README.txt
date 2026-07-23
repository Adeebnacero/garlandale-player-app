Garlandale FC Player Portal — COMPLETE build (unread notice count + read tracking)
======================================================================================

SAME FULL-REBUILD APPROACH - safest given past partial-push issues.

1. Delete everything in your local repo folder EXCEPT .git:
     find . -mindepth 1 -not -path './.git*' -delete

2. Unzip this file's contents into that now-empty folder.

3. Confirm structure:
     ls -la supabase/functions/
   SEVEN folders now: get-my-balance, get-my-profile, update-my-profile,
   get-my-fixtures, get-my-notices, mark-notice-read, get-my-notice-count.

4. Run the new migration in Supabase SQL Editor:
   notice_reads_migration.sql (separate download, not part of this zip -
   see the other file shared alongside this one)

5. Deploy the new/changed functions:
     supabase functions deploy get-my-notices
     supabase functions deploy mark-notice-read
     supabase functions deploy get-my-notice-count
   (the other four functions are unchanged this round - no need to
   redeploy them)

6. Commit and push:
     git add -A
     git commit -m "Add unread notice count badge and per-notice read tracking"
     git push

WHAT'S NEW THIS ROUND
- A gold badge on the "Notices" drawer item shows the unread count on
  every page.
- On the Notices page itself, unread notices show a small dot next to
  the title.
- A notice is marked read once its card has been genuinely visible on
  screen for ~0.6 seconds (not just rendered) - scrolling past quickly
  won't mark it read.
- New table: notice_reads (tracks which player has read which notice).

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html, accept-invite.html
  config.js, styles.css, manifest.json, service-worker.js
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/           (+ billing.js)
  supabase/functions/get-my-profile/           (+ billing.js)
  supabase/functions/update-my-profile/
  supabase/functions/get-my-fixtures/          (+ billing.js)
  supabase/functions/get-my-notices/           (updated - now includes is_read)
  supabase/functions/mark-notice-read/         (new)
  supabase/functions/get-my-notice-count/      (new)
