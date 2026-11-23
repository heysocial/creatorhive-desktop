"use strict";

/*
  The bookkeeping around updates that electron-updater doesn't do: whether a
  version is really newer than this one, whether the last "Restart to Update"
  actually installed, and a log of it all on this Mac.

  Why (Nov 23, Mykel on "2.0.63"): the "Update ready" banner showed on every
  launch. The banner's version is the one *downloaded*, not the one running,
  and nothing checked that installing it had worked: when Squirrel can't
  replace the app (it isn't writable by this user, or a second, older copy is
  the one being opened) the same old app comes back, downloads the same zip
  again (it's cached, so in seconds) and offers the same restart, forever.
  Nothing reached Admin → Bugs, and the updater only logged to a console
  nobody sees.

  Now:
    - a version is offered only when it's newer than app.getVersion();
    - before installing, the version being installed is written down; at the
      next launch, still being older than it means the install failed: that is
      reported once (with where the app is and whether it's writable), and
      instead of a Restart that can't work the app offers the download;
    - electron-updater's own log goes to ~/Library/Logs/CreatorHive/updates.log.
*/

const fs = require("fs");
const path = require("path");

const LOG_MAX_BYTES = 512 * 1024;

/** [major, minor, patch, prerelease|null], or null for something that isn't a version. */
function parse(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(version ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

/** semver order: < 0, 0 or > 0. A prerelease sorts before its release. Null when either isn't a version. */
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] === y[3]) return 0;
  if (x[3] === null) return 1;
  if (y[3] === null) return -1;
  const xs = x[3].split(".");
  const ys = y[3].split(".");
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    if (xn && yn && Number(xs[i]) !== Number(ys[i])) return Number(xs[i]) - Number(ys[i]);
    if (xn !== yn) return xn ? -1 : 1;
    if (xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}

/** Strictly newer than `current`. Anything unreadable is not newer. */
function isNewer(candidate, current) {
  const order = compare(candidate, current);
  return order !== null && order > 0;
}

/*
  What the last launch tried to install, kept in userData/update-install.json:
  { version, from, at }. Written just before quitAndInstall (or before a quit
  with an update waiting, which installs it too).
*/
function createInstallRecord(file) {
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return value && typeof value.version === "string" ? value : null;
    } catch {
      return null;
    }
  };
  const write = (value) => {
    try {
      fs.writeFileSync(file, JSON.stringify(value));
    } catch {
      // Not being able to remember only means a failed install isn't noticed.
    }
  };
  const clear = () => {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // As above.
    }
  };
  return { read, write, clear };
}

/**
 * At launch: what became of the last install.
 *   "none"      nothing was being installed;
 *   "installed" this is that version or newer (record cleared);
 *   "failed"    still older than it: the install didn't take.
 */
function installOutcome(record, currentVersion) {
  if (!record?.version) return "none";
  return isNewer(record.version, currentVersion) ? "failed" : "installed";
}

/** A logger electron-updater can use (info/warn/error/debug), appending to `fileOf()`, kept under LOG_MAX_BYTES. */
function fileLogger(fileOf, alsoConsole = true) {
  let ready = false;
  let file = null;
  const write = (level, args) => {
    const line = `${new Date().toISOString()} [${level}] ${args.map((arg) => (arg instanceof Error ? arg.stack || arg.message : typeof arg === "string" ? arg : safeJson(arg))).join(" ")}\n`;
    if (alsoConsole) (level === "error" ? console.error : console.log)("[update]", line.trimEnd());
    try {
      if (!ready) {
        file = typeof fileOf === "function" ? fileOf() : fileOf;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        ready = true;
      }
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch {
      // A log we can't write isn't worth breaking updates over.
    }
  };
  return {
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
    debug: (...args) => write("debug", args),
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The .app bundle this is running from, and whether this user can replace it (Squirrel needs to). */
function bundleInfo(exePath) {
  const bundle = exePath.includes(".app/") ? exePath.slice(0, exePath.indexOf(".app/") + 4) : exePath;
  let writable = false;
  try {
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return { bundle, writable };
}

module.exports = { parse, compare, isNewer, createInstallRecord, installOutcome, fileLogger, bundleInfo };
