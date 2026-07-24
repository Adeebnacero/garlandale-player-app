Garlandale FC Player Portal — COMPLETE build (scheduled caching)
====================================================================

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. No new/changed Edge Functions this round - purely frontend caching,
   no `supabase functions deploy` needed.
4. git add -A && git commit -m "Add scheduled caching (10am/5pm refresh windows)" && git push

WHAT'S NEW THIS ROUND
- New file: cache.js - a small shared helper used by all five pages.
- Every read (balance, fixtures, notices, notice count, active status,
  profile, loyalty) now only re-fetches from the network if a 10am or
  5pm boundary has passed since it was last fetched. Otherwise it reads
  from the browser's local storage instantly, no network call at all.
- First-ever visit for any given piece of data always fetches
  immediately - there's nothing to show otherwise.
- New "Refresh now" option in the drawer on every page - clears this
  player's cache and reloads, for whenever someone wants the latest
  data right away rather than waiting for the next window.
- Signing out also clears the cache, so nothing lingers if a device is
  shared between players.
- Cache is namespaced per logged-in player's own account - one player's
  cached data can never show up for a different player on a shared
  device.

TWO IMPORTANT FIXES BAKED IN (not just "add caching" - these prevent
real staleness bugs the caching would otherwise introduce):
- Saving your profile (phone/email/guardian info) immediately busts
  just that one cached entry, so you never see your OLD info again
  after editing - it doesn't wait for the next refresh window.
- Marking a notice as read immediately busts both the notices list and
  unread-count cache entries, so the badge and the "read" dot update
  right away, not on the next scheduled refresh.

ONE THING WORTH KNOWING
This is NOT the same as true background refresh - the app can't wake
itself up at 10am/5pm while closed (that would need push notifications/
background sync, a much bigger thing to build). What actually happens:
the NEXT time a page is opened after 10am (or 5pm), if it hasn't
already refreshed since that time today, it refreshes then. For a
player who opens the app in the morning and again after training,
this behaves the same as true scheduled refresh in practice.

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html,
  loyalty.html, accept-invite.html
  cache.js                                      (new)
  config.js, styles.css, manifest.json, service-worker.js
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/           (+ billing.js)
  supabase/functions/get-my-profile/           (+ billing.js)
  supabase/functions/update-my-profile/
  supabase/functions/get-my-fixtures/          (+ billing.js)
  supabase/functions/get-my-notices/
  supabase/functions/mark-notice-read/
  supabase/functions/get-my-notice-count/
  supabase/functions/get-my-active-status/
  supabase/functions/get-my-loyalty/
