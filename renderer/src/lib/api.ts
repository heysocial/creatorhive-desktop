import { QueryClient, useQuery } from "@tanstack/react-query";
import { ch } from "./bridge";

/* The server's shapes, as the website's API routes send them. */

export type Workspace = "creatorhive" | "heysocial";

export interface Channel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  unreadCount: number;
  mentionCount: number;
  memberCount: number;
  joined: boolean;
  lastMessageAt: string | null;
}

export interface Participant {
  id: string;
  name: string;
  avatarUrl: string | null;
  presence?: "online" | "away" | "offline" | string;
}

export interface Conversation {
  id: string;
  createdAt?: string;
  isGroup: boolean;
  workspace: Workspace;
  displayName: string;
  realtimeChannel: string;
  participants: Participant[];
  lastMessageId?: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthorId: string | null;
  unreadCount: number;
  /** 1:1 DMs: how far the other person has received and read (null on groups). */
  receipts?: { deliveredThrough: string | null; readThrough: string | null };
  receiptsSince?: string | null;
  other: Participant;
}

export interface SearchItem {
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  avatarUrl?: string | null;
  href: string;
  locked?: boolean;
}

export interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly data?: Record<string, unknown> | null) {
    super(code ?? `HTTP ${status}`);
  }
}

/**
 * The website's own sentence when it refused an action for going over a
 * per-member limit (429 `{ code: "rate_limited", error: "<sentence>" }`,
 * creatorhive-app lib/rate-limit.ts) — "You're sending too fast. Try again in
 * a minute." and the like — or null for any other failure. Takes an ApiError,
 * or a raw `{ status, data }` result from the bridge.
 */
export function rateLimitMessage(failure: unknown): string | null {
  const { status, data } = failure instanceof ApiError
    ? failure
    : ((failure ?? {}) as { status?: number; data?: Record<string, unknown> | null });
  if (status !== 429 || data?.code !== "rate_limited") return null;
  return typeof data.error === "string" && data.error.trim() ? data.error : null;
}

/** A JSON call through the main process. Throws on anything but success. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const result = await ch.api<T & { ok?: boolean; error?: string }>({ path, ...init });
  if (!result.ok || !result.data) throw new ApiError(result.status, result.error ?? result.data?.error, result.data as Record<string, unknown> | null);
  return result.data;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Signed out and "not for you" are answers, not hiccups.
      retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export const keys = {
  channels: (workspace: Workspace) => ["channels", workspace] as const,
  conversations: (workspace: Workspace) => ["conversations", workspace] as const,
  heySocialAccess: ["hey-social-access"] as const,
  search: (q: string) => ["search", q] as const,
};

export function useChannels(workspace: Workspace, enabled = true) {
  return useQuery({
    queryKey: keys.channels(workspace),
    enabled,
    queryFn: async () => (await api<{ channels: Channel[] }>(`/api/channels?workspace=${workspace}`)).channels,
  });
}

export function useConversations(workspace: Workspace, enabled = true) {
  return useQuery({
    queryKey: keys.conversations(workspace),
    enabled,
    queryFn: async () => (await api<{ conversations: Conversation[] }>(`/api/dms?workspace=${workspace}`)).conversations,
  });
}

/** Whether this member can open Hey Social Inc. (team and guests). */
export function useHeySocialAccess() {
  return useQuery({
    queryKey: keys.heySocialAccess,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        await api("/api/hey-social/access");
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return false;
        throw error;
      }
    },
  });
}

export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(query),
    enabled: query.length >= 2,
    staleTime: 60_000,
    queryFn: async () => (await api<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(query)}`)).groups,
  });
}
