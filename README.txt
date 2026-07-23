Garlandale Player App — full current state (iteration 3)
==========================================================

This folder mirrors your repo's root exactly - every file here should
land at the SAME path relative to your repo root, overwriting what's
already there.

  index.html                                  -> repo root
  home.html                                    -> repo root (now fetches
                                                   your REAL balance)
  config.js                                    -> repo root (already has
                                                   your Supabase URL/key)
  styles.css                                   -> repo root
  manifest.json                                -> repo root
  service-worker.js                            -> repo root
  icons/icon-192.png                           -> repo root/icons/
  icons/icon-512.png                           -> repo root/icons/
  supabase/functions/get-my-balance/index.ts    -> repo root/supabase/...
  supabase/functions/get-my-balance/billing.js  -> repo root/supabase/...

HOW TO USE THIS
1. Unzip this into your garlandale-player-app repo folder, letting it
   overwrite/merge with what's already there.
2. From inside the repo folder, confirm the function files landed
   correctly before deploying:
     ls -la supabase/functions/get-my-balance/
   You should see exactly: index.ts and billing.js (not index.ts.txt
   or anything renamed).
3. Deploy the function:
     supabase functions deploy get-my-balance
4. Commit and push everything:
     git add -A
     git commit -m "Iteration 3: real balance via get-my-balance edge function"
     git push

Vercel redeploys the frontend automatically on push - no separate step.
