Garlandale FC Player Portal — COMPLETE current build (fixtures added)
=========================================================================

SAME FULL-REBUILD APPROACH AS LAST TIME - safest given how many
partial pushes have caused issues before.

1. In your local repo folder, delete everything EXCEPT the hidden
   .git folder:
     find . -mindepth 1 -not -path './.git*' -delete

2. Unzip this file's contents directly into that now-empty folder.

3. Confirm the structure:
     ls -la
     ls -la supabase/functions/
   You should see FOUR folders inside supabase/functions/ now:
   get-my-balance, get-my-profile, update-my-profile, get-my-fixtures
   (get-my-balance also has billing.js alongside its index.ts).

4. Deploy all four functions:
     supabase functions deploy get-my-balance
     supabase functions deploy get-my-profile
     supabase functions deploy update-my-profile
     supabase functions deploy get-my-fixtures

5. Commit and push:
     git add -A
     git commit -m "Add fixtures screen"
     git push

WHAT'S NEW THIS ROUND
- fixtures.html - a new page listing every upcoming fixture
- home.html - the "Next fixture" card now shows a real fixture instead
  of a placeholder, and there's a new "Fixtures" link in the nav
- profile.html - added the same "Fixtures" nav link for consistency
- supabase/functions/get-my-fixtures/ - the new endpoint powering both
  of the above

FILES IN THIS BUILD
  index.html                                     sign-in page
  home.html                                       dashboard (real balance + real next fixture)
  profile.html                                    profile view/edit page
  fixtures.html                                   full upcoming fixtures list
  config.js                                       your Supabase URL + anon key
  styles.css                                      shared styling
  manifest.json                                   PWA metadata
  service-worker.js                               offline caching (network-first)
  icons/icon-192.png, icons/icon-512.png           app icons
  supabase/functions/get-my-balance/               balance calculation endpoint
  supabase/functions/get-my-profile/               profile read endpoint
  supabase/functions/update-my-profile/            profile edit endpoint
  supabase/functions/get-my-fixtures/              fixtures endpoint
