Garlandale FC Player Portal — COMPLETE build (redesigned fixture card)
==========================================================================

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. No new/changed Edge Functions this round - purely frontend, no
   `supabase functions deploy` needed.
4. git add -A && git commit -m "Redesign fixture card layout" && git push

WHAT'S NEW
Both the home screen's "Next fixture" card and the full fixtures list
now show:

  Garlandale FC vs Opponent
  Venue: Actual venue (Home) or (Away)
  Time: Sat, 26 July · 09:00
  Please report 1 hour before kick-off

- Team line always says "vs" now (previously showed "@" for away games)
- Home/Away is now a small tag next to the venue instead
- Venue and time each get their own labeled line
- Falls back to "TBC" if venue is genuinely blank, so the (Home)/(Away)
  tag never silently disappears
