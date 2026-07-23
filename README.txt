Garlandale FC Player Portal — Iteration 2 (real login, real pages)
====================================================================

WHAT CHANGED FROM ITERATION 1
- Two real, separate pages now (index.html = sign in, home.html =
  dashboard), with actual navigation between them - not a single page
  hiding/showing divs. The back button, refresh, and bookmarking all
  behave like a real site.
- The club badge is now embedded directly inside each HTML file, so it
  can never go missing due to an upload/folder-structure issue.
- Sign-in is REAL: it calls Supabase Auth, not a fake "any input works"
  form. Wrong credentials show a real error.
- Refreshing home.html actually checks whether you're really signed in
  (via Supabase) and bounces you back to the sign-in page if not.
- Sign out is REAL: it ends the actual Supabase session.

WHAT'S STILL FAKE
The balance card and next-fixture card on home.html are still hardcoded
placeholder numbers - the plumbing to fetch your real balance and real
fixtures comes in the next iteration.

BEFORE THIS WILL WORK: FILL IN config.js
Open config.js and fill in the two blank values:

  SUPABASE_URL      = your Project URL
  SUPABASE_ANON_KEY = your anon/public key

Both are on: Supabase Dashboard -> Settings -> API. Both are safe to
have in this client-side file - the anon key is meant to be public and
is protected by Row Level Security on the database side, not secrecy.

DEPLOYING
Same as before: all these files (including icons/, still needed for the
install icon) go into your GitHub repo, Vercel picks it up automatically,
no build step. If you're replacing iteration 1's files in the same repo,
just upload these on top - GitHub will let you overwrite.

ONE THING TO CHECK ON YOUR SUPABASE PROJECT
For a real player to actually sign in, their account needs to already
exist via the invite-player flow from the admin app (per the original
handoff doc) - this page can't create new accounts, only sign in to
ones that already exist and have had their password set.

FILES IN THIS FOLDER
  index.html          sign-in page (real Supabase Auth)
  home.html            dashboard page (real session check + sign out)
  config.js             <- fill this in with your Supabase URL + anon key
  styles.css            shared styling
  manifest.json          PWA metadata
  service-worker.js       offline caching (active once hosted)
  icons/icon-192.png       app icon
  icons/icon-512.png       app icon, larger
