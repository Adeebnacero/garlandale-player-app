Garlandale FC Player Portal — COMPLETE build (Training Schedule tile)
==========================================================================

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. No new/changed Edge Functions this round - only home.html changed,
   and it reuses the already-deployed get-my-notices. No
   `supabase functions deploy` needed.
4. git add -A && git commit -m "Add Training Schedule tile to home screen" && git push

WHAT'S NEW
- A new card on the home screen shows the training schedule, IF one has
  been posted.
- No new table, no new Edge Function - this is just an ordinary notice,
  same as any other. It's found by looking for a notice that's BOTH
  pinned AND has category = 'training'.

HOW TO POST YOUR TRAINING SCHEDULE (do this now to make the tile appear)
Supabase Dashboard -> Table Editor -> notices -> Insert row:

  title:      Training Schedule
  category:   training
  pinned:     true
  body:       (paste exactly, preserving the line breaks)

Wednesday and Fridays 5-6pm
Under 7, Under 8, Under 9, Under 10, Under 12, Under 14

Tuesday and Thursdays 5-6:30pm
Under 16, Under 18

Seniors
Wednesday 7-8:30pm

Over 40s
Getting out of bed is enough training

IMPORTANT: only ONE notice should have category='training' AND
pinned=true at a time - the home screen tile shows whichever one it
finds first. To update the schedule later, edit this same row directly
rather than inserting a new one, or the tile may pick the wrong one.
