# CreatorHive for Mac

The CreatorHive website (community.creatorhiveacademy.com) in its own Mac app, with:

- Mac notifications for DMs, @mentions, thread replies and Hey Social, even with the window closed
- the unread count on the Dock icon
- a menu bar icon with Open at login, notification switches and Quit
- automatic updates from this repo's GitHub Releases
- signing with a Developer ID and notarization by Apple

The window shows the live website unchanged, so website changes never need an app update.

## How notifications work

The server publishes every notification it sends to phones on the member's own Ably
channel (`user:<id>`, event `notification:desktop`). See `lib/push.ts` in the web app.
The app listens there from its main process, using the signed-in website session to
get an Ably token from `/api/realtime/token`, and shows a Mac notification. The Dock
badge comes from `/api/notifications/badge`.

## Develop

```sh
npm install
npm start                                            # against the live site
CREATORHIVE_URL=http://localhost:3000 npm start      # against a local copy
```

`CREATORHIVE_USER_DATA=<dir>` keeps a test run's sign-in and settings apart from the
real app's, and `CREATORHIVE_DEBUG=1` logs what the listener receives.

## Release

1. Bump `version` in `package.json`.
2. `npm run release` builds a universal app (Apple silicon + Intel), signs it,
   notarizes it, and publishes a GitHub release with the .dmg, .zip and `latest-mac.yml`.
   Installed apps pick it up within a few hours; the download page within five minutes.

Signing uses the "Developer ID Application: Simon Choucroun (Y76C9NAS53)" identity
in the login keychain. Notarization uses the App Store Connect API key in
`~/.creatorhive-desktop-signing/` (never commit it). `npm run dist` builds without
publishing.
