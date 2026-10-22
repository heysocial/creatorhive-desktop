import { useSyncExternalStore } from "react";

/*
  Where the person is: a workspace, a rail section, and a view inside it.
  Each workspace and section remembers its last view, the way Slack does, and
  every move is kept in a back/forward history (⌘[ and ⌘]).
*/

export type WorkspaceKey = "ch" | "hs";
export type Section = "home" | "dms" | "hub" | "learn" | "activity" | "later";

export type View =
  | { kind: "feed"; postId?: string }
  | { kind: "today" }
  | { kind: "events"; eventId?: string }
  | { kind: "profile"; id: string }
  | { kind: "leaderboard" }
  | { kind: "members" }
  | { kind: "channel"; id: string }
  | { kind: "dm"; id: string }
  | { kind: "dms-home" }
  | { kind: "hub"; page: "deals" | "dashboard" | "clients" | "invoices"; dealId?: string }
  | { kind: "learn"; page: "courses" | "improve" | "resources" }
  | { kind: "activity" }
  | { kind: "threads" }
  | { kind: "mentions" }
  | { kind: "saved" };

export interface Location {
  ws: WorkspaceKey;
  section: Section;
  view: View;
}

export const SECTIONS: Record<WorkspaceKey, Section[]> = {
  ch: ["home", "dms", "hub", "learn", "activity"],
  hs: ["home", "dms", "activity", "later"],
};

const DEFAULT_VIEW: Record<WorkspaceKey, Partial<Record<Section, View>>> = {
  ch: {
    home: { kind: "feed" },
    dms: { kind: "dms-home" },
    hub: { kind: "hub", page: "deals" },
    learn: { kind: "learn", page: "courses" },
    activity: { kind: "activity" },
  },
  hs: {
    home: { kind: "threads" },
    dms: { kind: "dms-home" },
    activity: { kind: "activity" },
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
    if (saved?.current?.ws && saved?.current?.view) return { ...saved, back: [], forward: [] };
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
