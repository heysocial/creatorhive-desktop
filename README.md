# CreatorHive for Mac

CreatorHive as a native-feeling Mac app (2.0, in progress). It has its own interface rather
than the website in a window, and works like Slack:

- **Window:** no title bar, with the window buttons in the app's own top bar.
- **Translucent rail and sidebar:** they use macOS's sidebar material.
- **Two workspaces:** CreatorHive and Hey Social Inc., switched from the rail.
- **Getting around:** ⌘K search, real Mac menus with shortcuts, and right-click menus.
- **Mac notifications:** for DMs, @mentions, thread replies and Hey Social, even with the window closed.
- **Dock badge, menu bar icon and open at login.**
- **Automatic updates:** from this repo's GitHub Releases.
- **Signing and notarization:** signed with a Developer ID and notarized by Apple.

1.0.x (on `main` until 2.0 ships) shows the live website in a window instead.

## How it fits together

```
renderer/          the interface: React + TypeScript, built by Vite into renderer/dist
src/main/index.js  window, menus, menu bar icon, Dock badge, notifications, updates
src/main/site.js   every request to the server, with the session's cookies
src/main/realtime.js  the one Ably connection; forwards messages to the interface
src/main/preload.js   window.ch: the only API the interface has
```

**Talking to the server**
- The interface makes no network calls itself. It asks for `/api/...` through `window.ch.api`.
- The main process makes the request with the signed-in session, so cookies never reach the page and CORS doesn't apply.
- Sign-in posts the same NextAuth credentials form the website's sign-in page uses.
- The cookie jar is the same one 1.x used, so updating from 1.x keeps people signed in.

**Notifications**
- The server publishes every notification it sends to phones on the member's own Ably channel (`user:<id>`, event `notification:desktop`). See `lib/push.ts` in the web app.
- The main process shows those as Mac notifications.
- It also forwards every message to the interface, which refreshes its channel and DM lists. The Dock badge comes from `/api/notifications/badge`.

## Develop

```sh
npm install
npm run dev                                          # Vite dev server inside Electron, live site
CREATORHIVE_URL=http://localhost:3000 npm run dev    # against a local copy of the site
npm run typecheck
```

Environment variables for test runs:
- `CREATORHIVE_USER_DATA=<dir>` keeps a test run's sign-in and settings apart from the real app's.
- `CREATORHIVE_DEBUG=1` logs what the listener receives.
- `CREATORHIVE_PREVIEW=1` behaves like the preview build.

## Preview builds (the team's 2.0)

"CreatorHive Preview" is the in-progress 2.0 for the team:
- It installs beside the real app, with its own bundle id, data folder and icon (with a PREVIEW band).
- Its notifications start off, so nobody gets everything twice. Turn them on from its menu bar icon.
- It updates only from GitHub **prereleases**. The real app and the download page use the latest full release, so they never see a preview.

```sh
# bump "version" to the next 2.0.0-preview.N first
npm run preview:release   # signs, notarizes, publishes a prerelease with preview-mac.yml
npm run preview:dist      # the same without publishing
```

## Release

1. Bump `version` in `package.json`.
2. `npm run release` builds a universal app (Apple silicon + Intel), signs it,
   notarizes it, and publishes a GitHub release with the .dmg, .zip and `latest-mac.yml`.
   Installed apps pick it up within a few hours; the download page within five minutes.

Signing uses the "Developer ID Application: Simon Choucroun (Y76C9NAS53)" identity
in the login keychain. Notarization uses the App Store Connect API key in
`~/.creatorhive-desktop-signing/` (never commit it). `npm run dist` builds without
publishing.
