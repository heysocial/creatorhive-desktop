import { Component, type ErrorInfo, type ReactNode } from "react";
import { ch } from "./bridge";
import { ApiError } from "./api";
import type { Location } from "./nav";

/*
  What this window reports to Admin → Bugs: uncaught errors, unhandled
  promise rejections and React render errors (ErrorBoundary below), on every
  screen, the sign-in screen included. The main process sends them
  (src/main/errors.js) with the session, deduped, capped, redacted and only
  when the app is packaged or CREATORHIVE_REPORT_ERRORS=1; the website tags
  each with the side of CreatorHive and the kind of member it came from.
  `route` is the screen in words ("Sign in", "Hub → Deals", "Channel"): never
  an id, a name or anything anybody wrote. Same as the 2.0.x app's
  renderer/src/lib/errors.tsx on main.
*/

const HUB_PAGES = { deals: "Deals", dashboard: "Dashboard", clients: "Clients", invoices: "Invoices" } as const;
const LEARN_PAGES = { courses: "Courses", improve: "Improve", resources: "Resources" } as const;

/** The screen a place in the app is, as a person would say it. */
export function screenFor(location: Location): string {
  const { view } = location;
  const hs = location.ws === "hs" ? "Hey Social → " : "";
  switch (view.kind) {
    case "feed": return "Home";
    case "today": return "Today";
    case "events": return "Events";
    case "leaderboard": return "Leaderboard";
    case "members": return "Members";
    case "channel": return `${hs}Channel`;
    case "dm": return `${hs}DM`;
    case "dms-home": return `${hs}DMs`;
    case "hub": return `Hub → ${HUB_PAGES[view.page]}`;
    case "learn": return `Learn → ${LEARN_PAGES[view.page]}`;
    case "activity": return `${hs}Activity`;
    case "threads": return "Hey Social → Threads";
    case "mentions": return "Hey Social → Mentions";
    case "saved": return "Hey Social → Saved";
  }
}

let screen = "Starting";
const MAX_PER_PAGE = 50;
let reported = 0;

/** The screen this window shows now: the App sets it as it changes ("Sign in" while signed out). */
export function setErrorScreen(next: string) {
  if (next === screen) return;
  screen = next;
  // Kept in the main process too, for a crash that takes this page with it.
  ch.errors?.setScreen(next);
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return { message: `${name}${error.message}`, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error) ?? String(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/*
  A chunk that fails to load means this window's code is older than the files
  next to it (an update swapped them underneath a running app). Reload once
  instead of reporting; if it fails again within five minutes, it is reported.
*/
const CHUNK_FAILURE =
  /Failed to load chunk|Loading chunk [\w./-]+ failed|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
const CHUNK_RELOAD_KEY = "creatorhive:chunk-reload-at";
const CHUNK_RETRY_WINDOW_MS = 5 * 60_000;

function reloadForStaleChunk(message: string): boolean {
  if (!CHUNK_FAILURE.test(message)) return false;
  try {
    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    if (last > 0 && now - last >= 0 && now - last < CHUNK_RETRY_WINDOW_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Not worth a report: a request that failed for being offline or signed out (the app already says so). */
function expected(error: unknown) {
  if (error instanceof ApiError) return error.status === 0 || error.status === 401;
  return error instanceof DOMException && error.name === "AbortError";
}

export function reportError(kind: "render" | "error" | "unhandled-rejection", error: unknown, componentStack?: string | null) {
  try {
    if (expected(error) || reported >= MAX_PER_PAGE) return;
    const { message, stack } = describe(error);
    if (!message || reloadForStaleChunk(message)) return;
    reported += 1;
    ch.errors?.report({ kind, message, stack, componentStack: componentStack ?? null, route: screen });
  } catch {
    // Reporting must never be the next error.
  }
}

/** Listen for this window's uncaught errors and rejections. Once, before the first render. */
export function installErrorReporting() {
  window.addEventListener("error", (event) => {
    // An image or script that didn't load also lands here, without an error.
    if (!event.error && !event.message) return;
    reportError("error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => reportError("unhandled-rejection", event.reason));
}

/** createRoot's: an error no boundary caught (the whole window goes blank). */
export function onUncaughtError(error: unknown, info: { componentStack?: string }) {
  console.error(error);
  reportError("render", error, info.componentStack);
}

/**
 * A screen that throws while drawing shows this instead of taking the whole
 * window with it, and is reported. `resetKey` changing (going somewhere
 * else) tries again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean; key?: string }> {
  state: { failed: boolean; key?: string } = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { failed: boolean; key?: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError("render", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="signin" role="alert">
        <div>
          <p><b>Something went wrong showing this.</b></p>
          <p>Reload to start this window again.</p>
          <button type="button" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
