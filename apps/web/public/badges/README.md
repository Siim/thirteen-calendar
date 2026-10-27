# App Store badges

`download-on-the-app-store-black.svg` and `download-on-the-app-store-white.svg` are Apple's official
"Download on the App Store" badges (US English), downloaded unmodified on 2026-10-19 from Apple Marketing Tools:

- https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us
- https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/white/en-us

(The older host, tools.applemarketingtools.com, no longer resolves; the toolbox host serves the same API.)

Apple's terms apply, not this repository's MIT license. In short (see the App Store Marketing Guidelines,
https://developer.apple.com/app-store/marketing/guidelines/):

- Use the badge only to link to the app's App Store page. Do not modify, recolour, animate, rotate or crop it,
  and do not combine it with other graphics.
- Keep it at least 40 px tall on screen, with clear space around it of at least a quarter of its height.
- Use the black badge on light backgrounds and the white badge on dark ones.
- The badge must not be the most prominent element on the page.

The web app shows the badge only when `APP_STORE_ID` in `apps/web/src/lib/downloads.ts` is set.
