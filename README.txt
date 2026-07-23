Garlandale FC Player Portal — COMPLETE build (slide-out drawer nav, Option B)
================================================================================

SAME FULL-REBUILD APPROACH - safest given past partial-push issues.

1. Delete everything in your local repo folder EXCEPT .git:
     find . -mindepth 1 -not -path './.git*' -delete

2. Unzip this file's contents into that now-empty folder.

3. Confirm structure:
     ls -la supabase/functions/
   Five folders: get-my-balance, get-my-profile, update-my-profile,
   get-my-fixtures, get-my-notices.

4. No new Edge Functions this round - only frontend changed. No
   `supabase functions deploy` needed.

5. Commit and push:
     git add -A
     git commit -m "Switch to slide-out drawer navigation (Option B)"
     git push

WHAT'S NEW THIS ROUND
- All four pages (home, profile, fixtures, notices) now use a hamburger
  menu (top-left) that opens a slide-out drawer, replacing the old
  top-ribbon text links.
- Each page highlights itself as the active item in the drawer.
- Tap anywhere outside the drawer (the dimmed background) to close it.
- Sign out is now inside the drawer, at the bottom.

This is purely a navigation/UI change - no database or Edge Function
changes, so nothing else in the app's behavior should be different.

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html, accept-invite.html
  config.js, styles.css, manifest.json, service-worker.js
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/       (+ billing.js)
  supabase/functions/get-my-profile/       (+ billing.js)
  supabase/functions/update-my-profile/
  supabase/functions/get-my-fixtures/      (+ billing.js)
  supabase/functions/get-my-notices/
