Garlandale FC Player Portal — COMPLETE build (badge in collapsed header)
============================================================================

SAME FULL-REBUILD APPROACH.

1. find . -mindepth 1 -not -path './.git*' -delete
2. Unzip this into the empty folder.
3. No new/changed Edge Functions this round - purely visual, no
   `supabase functions deploy` needed.
4. git add -A && git commit -m "Show club badge in collapsed header, hide while drawer open" && git push

WHAT'S NEW
- The collapsed header (before opening the drawer) now shows the club
  badge next to "Garlandale FC", instead of just bare text.
- Opening the drawer hides that header badge, since the drawer panel
  already shows its own badge at the top - avoids two badges on screen
  at once.
- Applies to all four pages: home, profile, fixtures, notices.
