import { useQuery } from "@tanstack/react-query";
import { api, queryClient, type Channel, type Conversation } from "./api";

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

/* ---------- Themes (sidebar, top bar and rail), from lib/hey-social/themes.ts ---------- */

export const THEMES: Record<string, { name: string; side: string; text: string; light: boolean }> = {
  classic: { name: "Classic", side: "", text: "", light: true },
  honey: { name: "Black & yellow", side: "#161616", text: "#F3F1ED", light: false },
  black: { name: "Black", side: "#1A1A1A", text: "#F3F1ED", light: false },
  purple: { name: "Purple", side: "#3F0E40", text: "#F3EAF3", light: false },
  ocean: { name: "Ocean", side: "#0E3A5A", text: "#E8F1F8", light: false },
  forest: { name: "Forest", side: "#1F3B2D", text: "#E9F2EC", light: false },
  rose: { name: "Rose", side: "#5A1E3A", text: "#F8EAF0", light: false },
  sand: { name: "Sand", side: "#F3EBDD", text: "#2B2620", light: true },
};
