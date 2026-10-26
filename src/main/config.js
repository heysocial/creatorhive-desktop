"use strict";

const { app } = require("electron");

/**
 * A `CREATORHIVE_*` testing override, or undefined in a packaged app.
 *
 * They exist for running from the repo against a local copy of the site. In
 * the shipped app they would let anything that can set an environment
 * variable for the user (`launchctl setenv`) point the window at another
 * server — the password typed at sign-in included — or load a remote page
 * with the full bridge. The preview build recognises itself by its name.
 */
function devEnv(name) {
  return app.isPackaged ? undefined : process.env[name];
}

/* Where the community lives. Point it at a local copy of the site for testing. */
const HOME_URL = devEnv("CREATORHIVE_URL") || "https://community.creatorhiveacademy.com";
const ORIGIN = new URL(HOME_URL).origin;

/*
  Vercel previews ask for a Vercel login, so members never land on one. A test
  run pointed at a preview (CREATORHIVE_URL=https://….vercel.app) passes the
  project's "Protection Bypass for Automation" secret in
  CREATORHIVE_PREVIEW_BYPASS. Never baked into a build, and ignored for any
  address that isn't a preview.
*/
const PREVIEW_BYPASS = new URL(ORIGIN).hostname.endsWith(".vercel.app")
  ? devEnv("CREATORHIVE_PREVIEW_BYPASS") || ""
  : "";

/* The same cookie jar 1.x used, so an update from 1.x keeps people signed in. */
const PARTITION = "persist:creatorhive";

/*
  The preview build ("CreatorHive Preview") installs beside the real app for the
  team. It has its own bundle id, data folder and update channel, and starts
  with notifications off so nobody gets every notification twice.
*/
const IS_PREVIEW = app.getName().includes("Preview")
  || process.execPath.includes("CreatorHive Preview.app")
  || devEnv("CREATORHIVE_PREVIEW") === "1";

/* In development the interface comes from Vite's dev server instead of the bundle. */
const RENDERER_URL = devEnv("CREATORHIVE_RENDERER_URL") || null;

const debug = (...args) => {
  if (devEnv("CREATORHIVE_DEBUG")) console.log("[creatorhive]", ...args);
};

module.exports = { HOME_URL, ORIGIN, PREVIEW_BYPASS, PARTITION, IS_PREVIEW, RENDERER_URL, debug, devEnv };
