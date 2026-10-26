"use strict";

/*
  Errors the Mac app hits, sent to the website's Admin → Bugs
  (POST /api/client-errors, platform "mac"): the interface's uncaught errors,
  unhandled promise rejections and React render errors (from every window,
  through preload's `ch.errors.report`), this process's own, and a window's
  page crashing. Sent from here with the session's cookie jar, so the server
  can say which member it was; signed out, it still goes (the route takes
  anonymous reports).

  Guard rails, since a broken screen can throw on every frame:
    - the same message and stack is sent once every DEDUPE_MS;
    - at most MAX_PER_SESSION reports per launch;
    - noise is dropped (ResizeObserver loops, aborted requests, network
      failures while the Mac is offline);
    - a failed send is only logged: never retried, never reported, so a
      server that's down can't make a loop;
    - query strings, bearer tokens and connection strings are taken out, as
      the website's own redact() does, and home folders shortened.
  In development (not a packaged app) nothing is sent unless
  CREATORHIVE_REPORT_ERRORS=1, so a local run doesn't fill Simon's list.
*/

const { app, net } = require("electron");
const { ORIGIN, IS_PREVIEW, debug } = require("./config");
const site = require("./site");

const DEDUPE_MS = 5 * 60 * 1000;
const MAX_PER_SESSION = 30;
const SEND_TIMEOUT_MS = 10 * 1000;
const KINDS = new Set(["render", "fatal", "error", "unhandled-rejection"]);
const LIMITS = { message: 1000, stack: 8000, componentStack: 4000, route: 300 };

const recent = new Map(); // message + stack -> when it was last sent
let sent = 0;
let sending = 0;

const enabled = () => app.isPackaged || process.env.CREATORHIVE_REPORT_ERRORS === "1";

function redact(text) {
  return text
    .replace(/\b(postgres(?:ql)?|mysql|redis):\/\/\S+/gi, "$1://[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/(https?:\/\/[^\s?#"'`)]+)\?[^\s"'`)]*/g, "$1?[redacted]")
    // Stack frames: the bundle's place inside the app, not where on this Mac the app is.
    .replace(/file:\/\/\/[^\s)]*?\/(app\.asar|renderer\/dist)\//g, "app/")
    .replace(/\/Users\/[^/\s)]+\//g, "~/");
}

function text(value, max) {
  if (typeof value !== "string") return null;
  const clean = redact(value.trim());
  if (!clean) return null;
  return clean.length > max ? clean.slice(0, max) : clean;
}

const NOISE = [
  /ResizeObserver loop/i,
  /^(AbortError|The (user|operation) (was )?aborted)/i,
  /\bAbortError\b/,
  /^Script error\.?$/i,
];
const NETWORK = /Failed to fetch|NetworkError|Load failed|net::ERR_|ERR_INTERNET_DISCONNECTED|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|^offline$/i;

/** The macOS version ("26.1", not "26.1.0"), as the iPhone sends iOS's. */
function osVersion() {
  try {
    return process.getSystemVersion().replace(/\.0$/, "");
  } catch {
    return null;
  }
}

/**
 * One report, from the interface or from this process. Returns why it wasn't
 * sent, for the logs and the tests ("sent" when it went).
 */
function report(input) {
  try {
    const kind = KINDS.has(input?.kind) ? input.kind : "error";
    const message = text(input?.message, LIMITS.message);
    if (!message) return "empty";
    const stack = text(input?.stack, LIMITS.stack);
    // A failure inside the reporting itself is never reported again.
    if (sending > 0 && stack?.includes("errors.js")) return "loop";
    if (NOISE.some((re) => re.test(message))) return "noise";
    if (NETWORK.test(message) && !net.isOnline()) return "offline";
    const key = `${message}\n${stack ?? ""}`;
    const now = Date.now();
    const last = recent.get(key);
    if (last && now - last < DEDUPE_MS) return "duplicate";
    if (sent >= MAX_PER_SESSION) return "capped";
    recent.set(key, now);
    if (recent.size > 200) for (const [k, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(k);
    const body = {
      platform: "mac",
      kind,
      message,
      stack,
      componentStack: text(input?.componentStack, LIMITS.componentStack),
      route: text(input?.route, LIMITS.route),
      appVersion: app.getVersion(),
      osVersion: osVersion(),
      channel: IS_PREVIEW ? "preview" : "production",
    };
    if (!enabled()) {
      debug("error not reported (development)", kind, message);
      return "development";
    }
    sent += 1;
    void send(body);
    return "sent";
  } catch (error) {
    console.error("[creatorhive] error report failed", error?.message);
    return "failed";
  }
}

async function send(body) {
  sending += 1;
  try {
    // An error before the app is ready (no session to send with yet) waits for it.
    if (!app.isReady()) await app.whenReady();
    const response = await site.appSession().fetch(`${ORIGIN}/api/client-errors`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", Origin: ORIGIN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    debug("error reported", response.status, body.kind, body.message.slice(0, 80));
  } catch (error) {
    debug("error report not sent", error?.message);
  } finally {
    sending -= 1;
  }
}

const describe = (error) => {
  if (error instanceof Error) return { message: error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message, stack: error.stack };
  try {
    return { message: typeof error === "string" ? error : JSON.stringify(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
};

/* The screen each window is on, for a crash that takes the page with it. */
const screens = new Map(); // webContents id -> "Admin → Members"

/**
 * This process's own failures and the windows' crashes. Listening for
 * uncaughtException keeps the app running (instead of Electron's error
 * dialog); the error is logged and reported.
 */
function configure(ipcMain) {
  process.on("uncaughtException", (error) => {
    console.error("[creatorhive] uncaught exception", error);
    report({ kind: "fatal", ...describe(error), route: "Main process" });
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[creatorhive] unhandled rejection", reason);
    report({ kind: "unhandled-rejection", ...describe(reason), route: "Main process" });
  });
  app.on("render-process-gone", (_event, contents, details) => {
    // Quitting, or macOS ending it to save memory, isn't a bug.
    if (details?.reason === "clean-exit" || details?.reason === "killed") return;
    console.error("[creatorhive] window's page gone", details?.reason, details?.exitCode);
    report({
      kind: "fatal",
      message: `Window crashed (${details?.reason ?? "unknown"}, exit code ${details?.exitCode ?? "?"})`,
      route: screens.get(contents?.id) ?? "Window",
    });
  });

  // From the interface: fire and forget.
  ipcMain.on("errors:report", (event, input) => {
    if (!input || typeof input !== "object") return;
    report({ ...input, route: typeof input.route === "string" ? input.route : screens.get(event.sender.id) });
  });
  ipcMain.on("errors:screen", (event, screen) => {
    if (typeof screen !== "string") return;
    const id = event.sender.id;
    if (!screens.has(id)) event.sender.once("destroyed", () => screens.delete(id));
    screens.set(id, screen.slice(0, LIMITS.route));
  });
}

module.exports = { configure, report, redact };
