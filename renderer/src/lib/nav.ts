import { useSyncExternalStore } from "react";
import type { AdminPage } from "./admin";

/*
  Where the person is: a workspace, a rail section, and a view inside it.
  Each workspace and section remembers its last view, the way Slack does, and
  every move is kept in a back/forward history (⌘[ and ⌘]).
*/

export type WorkspaceKey = "ch" | "hs";
export type Section = "home" | "dms" | "hub" | "learn" | "activity" | "later" | "admin";

export type View =
  | { kind: "feed"; postId?: string; commentId?: string }
  | { kind: "today" }
  | { kind: "events"; eventId?: string }
  | { kind: "profile"; id: string }
  | { kind: "leaderboard" }
  | { kind: "members" }
  | { kind: "channel"; id: string; threadId?: string; messageId?: string }
  | { kind: "dm"; id: string; threadId?: string; messageId?: string }
  | { kind: "dms-home" }
  | { kind: "hub"; page: "deals" | "dashboard" | "clients" | "invoices"; dealId?: string; board?: "outreach" | "campaigns" | "payment"; smart?: "due" | "awaiting" | "paid" | "retainers" }
  | { kind: "learn"; page: "courses" | "improve" | "resources" }
  | { kind: "activity"; tab?: "activity" | "threads"; filter?: "all" | "mentions" | "threads" | "reactions" }
  | { kind: "course"; id: string; lessonId?: string }
  | { kind: "resource"; id: string }
  | { kind: "improve-resource"; slug: string }
  | { kind: "script-writer"; chatId?: string }
  | { kind: "threads" }
  | { kind: "mentions" }
  | { kind: "saved" }
  | { kind: "hs-people" }
  | { kind: "admin"; page: AdminPage; id?: string };

export interface Location {
  ws: WorkspaceKey;
  section: Section;
  view: View;
}

export const SECTIONS: Record<WorkspaceKey, Section[]> = {
  // Admin only shows on the rail for people the website lets in (Rail.tsx).
  ch: ["home", "dms", "hub", "learn", "activity", "admin"],
  hs: ["home", "dms", "activity", "later"],
};

const DEFAULT_VIEW: Record<WorkspaceKey, Partial<Record<Section, View>>> = {
  ch: {
    home: { kind: "feed" },
    dms: { kind: "dms-home" },
    hub: { kind: "hub", page: "deals" },
    learn: { kind: "learn", page: "courses" },
    activity: { kind: "activity" },
    admin: { kind: "admin", page: "metrics" },
  },
  hs: {
    home: { kind: "threads" },
    dms: { kind: "dms-home" },
    activity: { kind: "mentions" },
    later: { kind: "saved" },
  },
};

const STORAGE_KEY = "ch.nav.v1";

interface State {
  current: Location;
  back: Location[];
  forward: Location[];
  remembered: Record<string, View>; // "ws:section" -> last view
  lastSection: Record<WorkspaceKey, Section>;
}

function initial(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved?.current?.ws && saved?.current?.view) {
      // An open deal doesn't come back on the next launch; its page does. Nor does a jump to one message.
      // Activity's filters before the server list (comments, hub, announcements) are All now.
      const clean = (v: View): View => (v.kind === "hub" ? { ...v, dealId: undefined } : v.kind === "channel" || v.kind === "dm" ? { ...v, messageId: undefined }
        : v.kind === "feed" ? { ...v, commentId: undefined }
        : v.kind === "activity" && v.filter && !["all", "mentions", "threads", "reactions"].includes(v.filter) ? { ...v, filter: undefined } : v);
      const remembered = Object.fromEntries(Object.entries(saved.remembered ?? {}).map(([k, v]) => [k, clean(v as View)]));
      return { ...saved, current: { ...saved.current, view: clean(saved.current.view) }, remembered, back: [], forward: [] };
    }
  } catch {
    // Nothing saved, or unreadable: start at Home.
  }
  return {
    current: { ws: "ch", section: "home", view: { kind: "feed" } },
    back: [],
    forward: [],
    remembered: {},
    lastSection: { ch: "home", hs: "home" },
  };
}

let state = initial();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    const { current, remembered, lastSection } = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ current, remembered, lastSection }));
  } catch {
    // Storage unavailable: navigation still works for this session.
  }
  listeners.forEach((listener) => listener());
}

const same = (a: Location, b: Location) => JSON.stringify(a) === JSON.stringify(b);

function go(to: Location) {
  if (same(to, state.current)) return;
  commit({
    current: to,
    back: [...state.back, state.current].slice(-100),
    forward: [],
    remembered: { ...state.remembered, [`${to.ws}:${to.section}`]: to.view },
    lastSection: { ...state.lastSection, [to.ws]: to.section },
  });
}

export const nav = {
  get: () => state.current,
  /** Open a view in the current workspace and section (or the one given). */
  open(view: View, section: Section = state.current.section, ws: WorkspaceKey = state.current.ws) {
    go({ ws, section, view });
  },
  /** Switch rail section; lands on whatever that section showed last. */
  section(section: Section, ws: WorkspaceKey = state.current.ws) {
    if (!SECTIONS[ws].includes(section)) return;
    const view = state.remembered[`${ws}:${section}`] ?? DEFAULT_VIEW[ws][section] ?? { kind: "feed" };
    go({ ws, section, view });
  },
  workspace(ws: WorkspaceKey) {
    if (ws === state.current.ws) return;
    nav.section(state.lastSection[ws] ?? "home", ws);
  },
  back() {
    const previous = state.back.at(-1);
    if (!previous) return;
    commit({ ...state, current: previous, back: state.back.slice(0, -1), forward: [state.current, ...state.forward] });
  },
  forward() {
    const next = state.forward[0];
    if (!next) return;
    commit({ ...state, current: next, back: [...state.back, state.current], forward: state.forward.slice(1) });
  },
  canGoBack: () => state.back.length > 0,
  canGoForward: () => state.forward.length > 0,
  /** After sign-out: forget where this account was. */
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
    state = initial();
    listeners.forEach((listener) => listener());
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNav() {
  return useSyncExternalStore(subscribe, () => state);
}
