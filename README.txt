Garlandale FC Player Portal — COMPLETE current build
======================================================

This mirrors your entire repo. To use it safely:

1. In your local repo folder, DELETE everything currently there
   EXCEPT the hidden .git folder (that's what tracks your GitHub
   connection - don't touch it).

   On Mac/Linux, from inside the repo folder:
     find . -mindepth 1 -not -path './.git*' -delete

   Or just do it manually in Finder - keep .git, delete everything else.

2. Unzip this file's contents directly into that now-empty repo folder.

3. Confirm the structure looks right:
     ls -la
     ls -la supabase/functions/
   You should see three folders inside supabase/functions/:
   get-my-balance, get-my-profile, update-my-profile - each containing
   an index.ts (get-my-balance also has billing.js alongside it).

4. Deploy all three functions:
     supabase functions deploy get-my-balance
     supabase functions deploy get-my-profile
     supabase functions deploy update-my-profile

5. Commit and push everything:
     git add -A
     git commit -m "Full rebuild - complete current state"
     git push

Vercel redeploys the frontend automatically on push.

WHY A FULL REBUILD THIS TIME
A couple of files landed in your repo either corrupted or missing
entirely over the last few rounds. Rather than keep patching piece by
piece, this is the whole thing in one go, from a version I've verified
end to end (checked every file has real content and every HTML file
actually closes its tags) - a clean baseline to work from.

FILES IN THIS BUILD
  index.html                                     sign-in page
  home.html                                       dashboard (balance + fixtures placeholder)
  profile.html                                    profile view/edit page
  config.js                                       your Supabase URL + anon key (already filled in)
  styles.css                                      shared styling
  manifest.json                                   PWA metadata
  service-worker.js                               offline caching (network-first)
  icons/icon-192.png, icons/icon-512.png           app icons
  supabase/functions/get-my-balance/               balance calculation endpoint
  supabase/functions/get-my-profile/               profile read endpoint
  supabase/functions/update-my-profile/            profile edit endpoint
