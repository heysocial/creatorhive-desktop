import { Component, type ErrorInfo, type ReactNode } from "react";
import { ch } from "./bridge";
import { ApiError } from "./api";
import { ADMIN_LABELS } from "./admin";
import { nav, type Location } from "./nav";

/*
  What this window reports to Admin → Bugs: uncaught errors, unhandled
  promise rejections and React render errors (ErrorBoundary below). The main
  process sends them (src/main/errors.js), deduped, capped, redacted and only
  when the app is packaged or CREATORHIVE_REPORT_ERRORS=1. `route` is the
  screen in words ("Admin → Members", "Channel", "DM"): never an id, a name
  or anything anybody wrote.
*/

const HUB_PAGES = { deals: "Deals", dashboard: "Dashboard", clients: "Clients", invoices: "Invoices" } as const;
const LEARN_PAGES = { courses: "Courses", improve: "Improve", resources: "Resources" } as const;

/** The screen a place in the app is, as a person would say it. */
export function screenFor(location: Location): string {
  const { view } = location;
  const hs = location.ws === "hs" ? "Hey Social → " : "";
  switch (view.kind) {
    case "feed": return view.postId ? "Home → Post" : "Home";
    case "today": return "Today";
    case "events": return "Events";
    case "profile": return "Profile";
    case "leaderboard": return "Leaderboard";
    case "members": return "Members";
    case "channel": return `${hs}Channel${view.threadId ? " → Thread" : ""}`;
    case "dm": return `${hs}DM${view.threadId ? " → Thread" : ""}`;
    case "dms-home": return `${hs}DMs`;
    case "hub": return `Hub → ${HUB_PAGES[view.page]}${view.dealId ? " → Deal" : ""}`;
    case "learn": return `Learn → ${LEARN_PAGES[view.page]}`;
    case "activity": return `${hs}Activity`;
    case "course": return view.lessonId ? "Course → Lesson" : "Course";
    case "resource": return "Learn → Resource";
    case "improve-resource": return "Improve → Guide";
    case "script-writer": return "Script Writer";
    case "threads": return "Hey Social → Threads";
    case "mentions": return "Hey Social → Mentions";
    case "saved": return "Hey Social → Saved";
    case "hs-people": return "Hey Social → People";
    case "admin": return `Admin → ${ADMIN_LABELS[view.page] ?? "Admin"}${view.id ? " → Detail" : ""}`;
  }
}

const POPOUT_SCREENS: Record<string, string> = {
  dm: "Pop-out → DM", channel: "Pop-out → Channel", thread: "Pop-out → Thread", deal: "Pop-out → Deal",
  lesson: "Pop-out → Lesson", settings: "Settings", huddle: "Huddle",
};

let currentScreen = () => "Unknown";
const MAX_PER_PAGE = 50;
let reported = 0;

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

/** Not worth a report: a request that failed for being offline or signed out (the app already says so). */
function expected(error: unknown) {
  if (error instanceof ApiError) return error.status === 0 || error.status === 401;
  return error instanceof DOMException && error.name === "AbortError";
}

export function reportError(kind: "render" | "error" | "unhandled-rejection", error: unknown, componentStack?: string | null) {
  try {
    if (expected(error) || reported >= MAX_PER_PAGE) return;
    const { message, stack } = describe(error);
    if (!message) return;
    reported += 1;
    ch.errors?.report({ kind, message, stack, componentStack: componentStack ?? null, route: currentScreen() });
  } catch {
    // Reporting must never be the next error.
  }
}

/**
 * Listen for this window's uncaught errors and rejections. `popout` is the
 * pop-out's kind; the main window follows `nav`.
 */
export function installErrorReporting(popout?: string) {
  currentScreen = popout ? () => POPOUT_SCREENS[popout] ?? "Pop-out" : () => screenFor(nav.get());
  // Kept in the main process too, for a crash that takes this page with it (the main window updates it as it moves: Main.tsx).
  ch.errors?.setScreen(currentScreen());
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
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; fallback?: "screen" | "window" }, { failed: boolean; key?: string }> {
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
      <div className="empty-state error-fallback" role="alert">
        <div>
          <p><b>Something went wrong showing this.</b></p>
          <p className="muted">{this.props.fallback === "window" ? "Reload to start this window again." : "Try again, or go somewhere else and come back."}</p>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => (this.props.fallback === "window" ? location.reload() : this.setState({ failed: false }))}>
            {this.props.fallback === "window" ? "Reload" : "Try again"}
          </button>
        </div>
      </div>
    );
  }
}
