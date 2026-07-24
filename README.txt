Garlandale FC Player Portal — COMPLETE build (security retro fixes)
========================================================================

SAME FULL-REBUILD APPROACH - but this is a BIGGER deploy than usual:
ALL NINE Edge Functions changed this round, not just one or two. Do
this methodically.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.

3. Run the new migration in Supabase SQL Editor:
   rate_limits_migration.sql (separate download, not part of this zip)

4. Deploy ALL NINE functions - every single one changed this round:
     supabase functions deploy get-my-balance
     supabase functions deploy get-my-profile
     supabase functions deploy update-my-profile
     supabase functions deploy get-my-fixtures
     supabase functions deploy get-my-notices
     supabase functions deploy mark-notice-read
     supabase functions deploy get-my-notice-count
     supabase functions deploy get-my-active-status
     supabase functions deploy get-my-loyalty

5. Commit and push:
     git add -A
     git commit -m "Security retro: fix service worker cache scope, add rate limiting, fix XSS in fixtures"
     git push

WHAT CHANGED THIS ROUND (a full security review, three real issues found and fixed)

1. SERVICE WORKER WAS CACHING API RESPONSES (the serious one)
   Previously, service-worker.js cached EVERY successful response it saw,
   including calls to Supabase (balance, profile with guardian contact
   info, everything) - not just this app's own static files. That cache
   isn't per-user, so on a shared device, one player's cached data could
   theoretically be served back to a different player later. Fixed:
   the service worker now ONLY caches same-origin static files. Every
   Supabase call passes straight through with zero caching, always.
   Cache version bumped, which wipes out anything already cached under
   the old, broader behavior on anyone's existing installed app.
   Sign-out on every page now also clears Cache Storage entirely, as an
   extra layer.

2. NO RATE LIMITING EXISTED (the big one)
   The original architecture doc called for this from day one but it
   was never actually built. Now: a new api_rate_limits table (locked
   down with RLS + zero policies, so ONLY the service role can ever
   touch it) tracks requests per user per endpoint. Every one of the
   nine Edge Functions now rejects with a 429 if a player hits it too
   often:
     - Most read endpoints: 30 requests / 60 seconds
     - update-my-profile (a write): 10 requests / 60 seconds
     - mark-notice-read (fires once per notice scrolled): 60 / 60 seconds
   Fails OPEN if the rate-limit check itself has an infrastructure
   problem - a DB hiccup on the rate-limit table should never block a
   legitimate player from using the app.

3. UNESCAPED TEXT IN fixtures.html (the quick one)
   Opponent and venue names were injected into the page via innerHTML
   without escaping - notices.html already did this correctly, fixtures
   hadn't. Low real-world risk today (only staff can currently write
   match data), but now consistent with the rest of the app.

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html,
  loyalty.html, accept-invite.html
  cache.js, config.js, styles.css, manifest.json
  service-worker.js                              (fixed - origin-restricted caching)
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/              (+ billing.js, rate-limit.js)
  supabase/functions/get-my-profile/              (+ billing.js, rate-limit.js)
  supabase/functions/update-my-profile/           (+ rate-limit.js)
  supabase/functions/get-my-fixtures/             (+ billing.js, rate-limit.js)
  supabase/functions/get-my-notices/              (+ rate-limit.js)
  supabase/functions/mark-notice-read/            (+ rate-limit.js)
  supabase/functions/get-my-notice-count/         (+ rate-limit.js)
  supabase/functions/get-my-active-status/        (+ rate-limit.js)
  supabase/functions/get-my-loyalty/              (+ rate-limit.js)
