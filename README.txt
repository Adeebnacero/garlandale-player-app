Garlandale FC Player Portal — COMPLETE build (Loyalty tab)
================================================================

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. Run the new migration in Supabase SQL Editor:
   partners_migration.sql (separate download, not part of this zip)
4. Deploy the two new functions:
     supabase functions deploy get-my-active-status
     supabase functions deploy get-my-loyalty
   (all other functions are unchanged this round)
5. git add -A && git commit -m "Add Loyalty tab (membership card + partner carousel)" && git push

WHAT'S NEW THIS ROUND
- New "Loyalty" item in the drawer - only appears for ACTIVE players,
  hidden entirely for inactive ones (checked on every page load).
- New loyalty.html page: a digital membership tile (badge, name, reg
  number) plus a horizontal-scrolling row of partner logos.
- New `partners` table - staff add/edit/deactivate partners directly
  via Supabase Table Editor (same stopgap pattern as notices).

HOW TO ADD A PARTNER
1. Get the partner's logo as an image file.
2. Supabase Dashboard -> Storage -> create a bucket (e.g. "partner-logos"),
   make it public, upload the logo there, copy its public URL.
3. Supabase Dashboard -> Table Editor -> partners -> Insert row:
     name          - e.g. "Joe's Sports Store"
     logo_url      - the public URL from step 2
     active        - true
     display_order - a number controlling carousel order (lower = earlier)

TO DEACTIVATE A PARTNER
Table Editor -> partners -> find the row -> set active to false.
No need to delete the row - it just stops showing to players.

NOTE FOR LATER
get-my-loyalty's code has a comment marking where a per-player QR code
would be generated and added to the response, whenever that's wanted -
the response shape was built so that's a pure addition, not a restructure.

FILES IN THIS BUILD
  index.html, home.html, profile.html, fixtures.html, notices.html,
  loyalty.html, accept-invite.html
  config.js, styles.css, manifest.json, service-worker.js
  icons/icon-192.png, icons/icon-512.png
  supabase/functions/get-my-balance/           (+ billing.js)
  supabase/functions/get-my-profile/           (+ billing.js)
  supabase/functions/update-my-profile/
  supabase/functions/get-my-fixtures/          (+ billing.js)
  supabase/functions/get-my-notices/
  supabase/functions/mark-notice-read/
  supabase/functions/get-my-notice-count/
  supabase/functions/get-my-active-status/     (new)
  supabase/functions/get-my-loyalty/           (new)
