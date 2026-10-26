import { useQuery } from "@tanstack/react-query";
import { api, queryClient, type Channel, type Conversation } from "./api";
import { ch } from "./bridge";

/* Hey Social Inc.: the Slack-like workspace's own data (lib/hey-social on the website). */

export interface Prefs { starred: boolean; muted: boolean; sectionId: string | null; sortOrder: number | null }
export interface Section { id: string; name: string; collapsed: boolean; sortOrder: number }
export type HsChannel = Channel & Prefs & { workspaceOpen: boolean };
export type HsDm = Conversation & Prefs;

export interface HsSidebar {
  access: "member" | "guest";
  sections: Section[];
  channels: HsChannel[];
  dms: HsDm[];
  counts: { threads: number; activity: number; saved: number };
  memberCount: number;
  theme: string;
  builtinLabels: { starred?: string; channels?: string; dms?: string };
  savedMessageIds: string[];
}

export const HS_KEY = ["hey-social", "sidebar"] as const;

export function useHsSidebar(enabled = true) {
  return useQuery({ queryKey: HS_KEY, enabled, queryFn: () => api<HsSidebar>("/api/hey-social/sidebar") });
}

export const refreshHs = () => queryClient.invalidateQueries({ queryKey: ["hey-social"] });

export async function setPrefs(kind: "channel" | "dm", id: string, patch: Partial<Pick<Prefs, "starred" | "muted" | "sectionId">>) {
  queryClient.setQueryData<HsSidebar>(HS_KEY, (s) => s && ({
    ...s,
    channels: kind === "channel" ? s.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) : s.channels,
    dms: kind === "dm" ? s.dms.map((d) => (d.id === id ? { ...d, ...patch } : d)) : s.dms,
  }));
  await api("/api/hey-social/sidebar/prefs", { method: "PUT", body: { kind, id, ...patch } }).catch(() => null);
  void refreshHs();
}

export async function addSection(name: string) {
  const { section } = await api<{ section: Section }>("/api/hey-social/sidebar/sections", { method: "POST", body: { name } });
  void refreshHs();
  return section;
}

export interface Place { kind: "channel" | "dm"; id: string; label: string; href: string }

export interface ThreadItem {
  parentId: string; author: { id: string; name: string; avatarUrl: string | null }; preview: string; createdAt: string;
  replyCount: number; lastReplyAt: string | null; lastReplyAuthor: { id: string; name: string; avatarUrl: string | null } | null; lastReplyPreview: string | null; unread: boolean; place: Place;
}
export interface ActivityItem { kind: "mention" | "reaction"; id: string; at: string; unread: boolean; actor: { id: string; name: string; avatarUrl: string | null }; emoji: string | null; messageId: string; preview: string; place: Place }
export interface SavedItem { messageId: string; status: "in_progress" | "archived" | "completed"; savedAt: string; remindAt: string | null; remindedAt: string | null; author: { id: string; name: string; avatarUrl: string | null }; preview: string; createdAt: string; place: Place }

export const useHsThreads = () => useQuery({ queryKey: ["hey-social", "threads"], queryFn: async () => (await api<{ threads: ThreadItem[] }>("/api/hey-social/threads")).threads });
export const useHsActivity = () => useQuery({ queryKey: ["hey-social", "activity"], queryFn: async () => (await api<{ items: ActivityItem[] }>("/api/hey-social/activity")).items });
export const useHsSaved = (status: SavedItem["status"]) => useQuery({
  queryKey: ["hey-social", "saved", status],
  queryFn: () => api<{ items: SavedItem[]; counts: Record<SavedItem["status"], number> }>(`/api/hey-social/saved?status=${status}`),
});

export async function toggleSaved(messageId: string, saved: boolean) {
  queryClient.setQueryData<HsSidebar>(HS_KEY, (s) => s && ({
    ...s,
    savedMessageIds: saved ? [messageId, ...s.savedMessageIds] : s.savedMessageIds.filter((id) => id !== messageId),
    counts: { ...s.counts, saved: s.counts.saved + (saved ? 1 : -1) },
  }));
  await (saved
    ? api("/api/hey-social/saved", { method: "POST", body: { messageId } })
    : api(`/api/hey-social/saved?messageId=${messageId}`, { method: "DELETE" })).catch(() => null);
  void refreshHs();
}

/** A website link to a Hey Social place (/hey-social?c=slug&thread=…, /hey-social/dm?convo=…), as a view in the app. */
export function placeView(place: Place, threadId?: string, messageId?: string) {
  return place.kind === "channel" ? { kind: "channel" as const, id: place.id, threadId, messageId } : { kind: "dm" as const, id: place.id, threadId, messageId };
}

/** A mention or a saved message: its place, opened at the message (and its thread, which the channel link names). */
export function messageView(place: Place, messageId: string) {
  const thread = place.kind === "channel" ? new URL(place.href, "https://app.invalid").searchParams.get("thread") ?? undefined : undefined;
  return placeView(place, thread, messageId);
}

/* ---------- Huddles ---------- */

export interface Huddle { id: string; target: { kind: "channel" | "dm"; id: string }; startedAt: string; participants: { id: string; name: string; avatarUrl: string | null }[] }
export function useHuddles(enabled = true) {
  return useQuery({
    queryKey: ["hey-social", "huddles"],
    enabled,
    refetchInterval: 60_000,
    queryFn: () => api<{ configured: boolean; huddles: Huddle[] }>("/api/hey-social/huddles"),
  });
}
export const huddleFor = (huddles: Huddle[] | undefined, kind: "channel" | "dm", id: string) => huddles?.find((h) => h.target.kind === kind && h.target.id === id);

/* ---------- Themes (sidebar, top bar and rail), copied from the website's lib/hey-social/themes.ts ---------- */
/*
  One setting for both apps: the theme lives on the server
  (GET/PATCH /api/hey-social/settings), so picking one here or on the website
  changes both. When the website's table changes, copy it again.
*/

export interface ThemeTokens {
  /** Sidebar and rail background. */
  side: string;
  /** Top bar background. */
  top: string;
  text: string;
  /** Section titles, quiet rows. */
  muted: string;
  hover: string;
  border: string;
  activeBg: string;
  activeText: string;
  /** The "Team only" pill. */
  pillBg: string;
  pillText: string;
  /** Text and icons on the top bar, when it differs from the sidebar's. */
  topText?: string;
  topMuted?: string;
  topField?: string;
}

export interface HeySocialTheme {
  id: string;
  name: string;
  description: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}

export const HEY_SOCIAL_THEMES: HeySocialTheme[] = [
  {
    id: "classic",
    name: "Classic",
    description: "CreatorHive's own light and dark",
    // Not applied: the app's tokens as they are. Listed for the picker's preview.
    light: { side: "#FBFAF8", top: "#FFFFFF", text: "#1F1E1C", muted: "#6E6B66", hover: "#F1F0ED", border: "#E6E4DF", activeBg: "#FFF1BF", activeText: "#1F1E1C", pillBg: "#FFF4CC", pillText: "#7A5B00" },
    dark: { side: "#1C1C1C", top: "#212121", text: "#ECECEC", muted: "#9A9A9A", hover: "#2A2A2A", border: "#303030", activeBg: "#353535", activeText: "#FFFFFF", pillBg: "#2E2E2E", pillText: "#F5C518" },
  },
  {
    id: "honey",
    name: "Black & yellow",
    description: "Honey on black, the Hey Social colours",
    light: { side: "#161616", top: "#FFCC04", text: "#F2F2F2", muted: "#B0B0B0", hover: "#262626", border: "#333333", activeBg: "#FFCC04", activeText: "#1F1E1C", pillBg: "#2B2B2B", pillText: "#FFD84D", topText: "#1F1E1C", topMuted: "#4A3D00", topField: "#FFE066" },
    dark: { side: "#111111", top: "#0B0B0B", text: "#F2F2F2", muted: "#A6A6A6", hover: "#222222", border: "#2C2C2C", activeBg: "#FFCC04", activeText: "#1F1E1C", pillBg: "#262626", pillText: "#FFCC04", topText: "#FFCC04", topMuted: "#C9A63A", topField: "#1C1C1C" },
  },
  {
    id: "black",
    name: "Black",
    description: "Quiet and high-contrast",
    light: { side: "#1A1A1A", top: "#111111", text: "#F2F2F2", muted: "#ABABAB", hover: "#292929", border: "#353535", activeBg: "#3B3B3B", activeText: "#FFFFFF", pillBg: "#2C2C2C", pillText: "#E5E5E5" },
    dark: { side: "#0F0F0F", top: "#0A0A0A", text: "#F2F2F2", muted: "#9E9E9E", hover: "#1D1D1D", border: "#292929", activeBg: "#313131", activeText: "#FFFFFF", pillBg: "#232323", pillText: "#DADADA" },
  },
  {
    id: "purple",
    name: "Purple",
    description: "Aubergine, like classic Slack",
    light: { side: "#3F0E40", top: "#350D36", text: "#FFFFFF", muted: "#CFC3CF", hover: "#521A53", border: "#5A2A5B", activeBg: "#6E3470", activeText: "#FFFFFF", pillBg: "#5A2259", pillText: "#F4D8F2" },
    dark: { side: "#2A0B2B", top: "#200822", text: "#F7F0F7", muted: "#BFAFC0", hover: "#3B163C", border: "#46204A", activeBg: "#5B2C5D", activeText: "#FFFFFF", pillBg: "#43173F", pillText: "#EBC9E8" },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue",
    light: { side: "#0E3A5A", top: "#0A2E48", text: "#FFFFFF", muted: "#BDD0DE", hover: "#164A6F", border: "#1F5277", activeBg: "#22608F", activeText: "#FFFFFF", pillBg: "#17496E", pillText: "#CFE6F7" },
    dark: { side: "#0A2840", top: "#071F33", text: "#F1F6FA", muted: "#A9BFCF", hover: "#113755", border: "#183F5E", activeBg: "#1D507A", activeText: "#FFFFFF", pillBg: "#123A5A", pillText: "#C2DDF0" },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Dark green",
    light: { side: "#1F3B2D", top: "#183024", text: "#FFFFFF", muted: "#C0D2C6", hover: "#2A4B3A", border: "#335644", activeBg: "#3A6550", activeText: "#FFFFFF", pillBg: "#2C4C3B", pillText: "#CFEBD9" },
    dark: { side: "#142A20", top: "#0F2119", text: "#F2F7F4", muted: "#A9BEB1", hover: "#1E3A2D", border: "#264536", activeBg: "#2F5544", activeText: "#FFFFFF", pillBg: "#1F3D2F", pillText: "#C2E3CE" },
  },
  {
    id: "rose",
    name: "Rose",
    description: "Berry and pink",
    light: { side: "#5A1E3A", top: "#4A182F", text: "#FFFFFF", muted: "#E2C3D1", hover: "#6C2948", border: "#753250", activeBg: "#8C3D62", activeText: "#FFFFFF", pillBg: "#6E2A4A", pillText: "#FBD9E8" },
    dark: { side: "#3D1428", top: "#311020", text: "#FBF2F6", muted: "#CBAEBC", hover: "#4E1D35", border: "#58243D", activeBg: "#73314F", activeText: "#FFFFFF", pillBg: "#521D37", pillText: "#F2CADC" },
  },
  {
    id: "sand",
    name: "Sand",
    description: "Warm and light",
    light: { side: "#F3EBDD", top: "#EADFCB", text: "#2B2620", muted: "#6B6052", hover: "#E8DCC6", border: "#DCCDB3", activeBg: "#E3C26B", activeText: "#2B2620", pillBg: "#EAD9AE", pillText: "#5E4600" },
    dark: { side: "#2A251E", top: "#221E18", text: "#F3EDE3", muted: "#B4A895", hover: "#352F27", border: "#3F382E", activeBg: "#6B5524", activeText: "#FFF7E6", pillBg: "#3B3220", pillText: "#E8C878" },
  },
];

export const DEFAULT_THEME = "classic";

/**
 * The CSS for one theme: the top bar, rail and sidebar take its colours while
 * you're in Hey Social Inc., light or dark with the app. Classic is the app as
 * it is. The website's tokens mapped onto this app's.
 */
export function themeCss(id: string | null | undefined): string {
  const theme = HEY_SOCIAL_THEMES.find((t) => t.id === id);
  if (!theme || theme.id === DEFAULT_THEME) return "";
  const on = `.app[data-hs-theme="${theme.id}"]`;
  const rules = (t: ThemeTokens) => {
    const topText = t.topText ?? t.text;
    const topMuted = t.topMuted ?? t.muted;
    const field = t.topField ?? t.hover;
    return [
      `${on} .sidebar, ${on} .rail { background: ${t.side}; color: ${t.text}; --ink: ${t.text}; --ink-2: ${t.text}; --ink-3: ${t.muted}; --ink-4: ${t.muted};` +
        ` --line: ${t.border}; --line-strong: ${t.border}; --sel: ${t.hover}; --glass-strong: ${t.activeBg}; --glass-edge: transparent;` +
        ` --card-2: ${t.side}; --card-3: ${t.hover}; --honey-soft: ${t.pillBg}; --honey-ink: ${t.pillText}; }`,
      `${on} .sb-item.on, ${on} .sb-item.on > svg, ${on} .ritem.on .ib { color: ${t.activeText}; }`,
      `${on} .topbar { background: ${t.top}; color: ${topText}; --ink: ${topText}; --ink-2: ${topText}; --ink-3: ${topMuted}; --ink-4: ${topMuted};` +
        ` --line-strong: ${t.border}; --sel: ${field}; --glass-strong: ${field}; --glass-edge: transparent; }`,
    ].join("\n");
  };
  return `${rules(theme.light)}\n@media (prefers-color-scheme: dark) {\n${rules(theme.dark)}\n}`;
}

/** Save your theme or section titles (the website's Preferences), shown at once. */
export async function saveHsSettings(body: { theme?: string; builtinLabels?: Partial<Record<"starred" | "channels" | "dms", string>> }) {
  queryClient.setQueryData<HsSidebar>(HS_KEY, (old) => (old ? { ...old, ...(body.theme ? { theme: body.theme } : {}), ...(body.builtinLabels ? { builtinLabels: { ...old.builtinLabels, ...body.builtinLabels } } : {}) } : old));
  try {
    await api("/api/hey-social/settings", { method: "PATCH", body });
  } finally {
    void refreshHs();
    // The Settings window has its own cache: tell the main window too.
    ch.app.relay({ topic: "hey-social", action: "settings" });
  }
}
