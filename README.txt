Garlandale FC Player Portal — Iteration 1 (preview shell)
===========================================================

WHAT THIS IS
A working preview of the login + home screens, with the real club crest
and matching colors/fonts. All data on the home screen (name, balance,
fixture) is hardcoded/fake - nothing here talks to Supabase yet.

HOW TO OPEN IT RIGHT NOW
Just double-click index.html. It'll open in your default browser and
work exactly as you've already seen - type anything into the login form
and hit "Sign in" to see the home screen.

WHAT WON'T WORK YET (AND WHY)
- "Add to Home Screen" / true install prompt: browsers only offer this
  for pages served over http/https, not opened as a local file. This is
  a browser security rule, not something we can flip a setting for.
- Offline caching (the service-worker.js file): same reason - service
  workers refuse to run under file://. The code is already there and
  will work automatically the moment this sits on a real web host.

WHEN YOU'RE READY FOR A REAL HOSTED VERSION
Any static hosting works (many have free tiers) - the whole folder
(index.html, manifest.json, service-worker.js, icons/) just needs to be
uploaded as-is, no build step required since this is plain HTML/CSS/JS.
That's a separate, later step - no need to think about it now.

FILES IN THIS FOLDER
  index.html          the app itself
  manifest.json        PWA metadata (name, colors, icons)
  service-worker.js     offline caching (inactive until hosted)
  icons/icon-192.png    app icon (from the club crest)
  icons/icon-512.png    app icon, larger size
