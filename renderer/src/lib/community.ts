import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api, queryClient } from "./api";

/* Phase 2 data: messages, the feed, events, the leaderboard and members. Shapes as the website's routes send them. */

export interface MemberBadge {
  kind: "owner" | "team" | "new" | "hustle" | "pro" | "top" | string;
  label: string;
  colorKey?: string;
}

export interface Author {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  instagram?: string | null;
  badge?: MemberBadge | null;
}

export type Reactions = Record<string, { count: number; mine: boolean }>;

export interface Attachment {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  kind: "image" | "file";
  previewUrl?: string;
}

export interface VideoAttachment {
  uid: string;
  fileName: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  embedUrl: string;
  status: "processing" | "ready" | "error";
  hlsUrl?: string | null;
  unavailable?: boolean;
}

export interface VoiceMemo {
  durationSeconds: number;
  waveform: number[];
  mimeType: string;
  url: string | null;
}

export interface ThreadSummary {
  replyCount: number;
  lastReplyAt: string;
  repliers: { id: string; name: string; avatarUrl: string | null }[];
}

export interface Message {
  id: string;
  clientMutationId?: string | null;
  body: string;
  bodyHtml?: string | null;
  attachments?: Attachment[];
  mediaUrls: string[];
  parentMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  author: Author;
  videoAttachment?: VideoAttachment | null;
  videoAttachments?: VideoAttachment[];
  voiceMemo?: VoiceMemo | null;
  threadSummary?: ThreadSummary | null;
  reactions?: Reactions;
  pin?: { at: string; by: { id: string; name: string } | null } | null;
  replyTo?: { id: string; body: string; author: { id: string; name: string } } | null;
  huddle?: unknown;
  /** Client-only: still on its way. */
  sending?: boolean;
  failed?: boolean;
}

export interface Page {
  messages: Message[];
  nextCursor: string | null;
  receipts?: { deliveredThrough: string | null; readThrough: string | null };
}

/** "channel" or "dm" plus its id: where a message list lives on the server. */
export interface Thread {
  kind: "channel" | "dm";
  id: string;
}

const base = (where: Thread) => (where.kind === "channel" ? `/api/channels/${where.id}` : `/api/dms/${where.id}`);

export const messageKeys = {
  list: (where: Thread) => ["messages", where.kind, where.id] as const,
  replies: (where: Thread, parentId: string) => ["replies", where.kind, where.id, parentId] as const,
};

/** Newest page first in `pages`; each page's messages are oldest first, as the server sends them. */
export function useMessages(where: Thread) {
  return useInfiniteQuery({
    queryKey: messageKeys.list(where),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(`${base(where)}/messages?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 10_000,
  });
}

export function useReplies(where: Thread, parentId: string | null) {
  return useQuery({
    queryKey: messageKeys.replies(where, parentId ?? ""),
    enabled: Boolean(parentId),
    queryFn: () => api<{ parent: Message; replies: Message[] }>(`${base(where)}/messages/${parentId}/replies`),
  });
}

export const flatten = (data: InfiniteData<Page> | undefined) =>
  data ? [...data.pages].reverse().flatMap((page) => page.messages) : [];

/* ---------- Edits to the cached list (sending, live updates) ---------- */

type Patch = (message: Message) => Message | null;

function patchList(where: Thread, patch: Patch) {
  queryClient.setQueryData<InfiniteData<Page>>(messageKeys.list(where), (data) => {
    if (!data) return data;
    return { ...data, pages: data.pages.map((page) => ({ ...page, messages: page.messages.map(patch).filter(Boolean) as Message[] })) };
  });
}

function patchReplies(where: Thread, patch: Patch) {
  for (const [key, data] of queryClient.getQueriesData<{ parent: Message; replies: Message[] }>({ queryKey: ["replies", where.kind, where.id] })) {
    if (!data) continue;
    const parent = patch(data.parent) ?? data.parent;
    queryClient.setQueryData(key, { parent, replies: data.replies.map(patch).filter(Boolean) as Message[] });
  }
}

export function patchMessage(where: Thread, id: string, change: (message: Message) => Message | null) {
  const patch: Patch = (message) => (message.id === id ? change(message) : message);
  patchList(where, patch);
  patchReplies(where, patch);
}

/** A new top-level message (or our own optimistic copy) at the bottom; replaces a matching optimistic copy. */
export function addMessage(where: Thread, message: Message) {
  if (message.parentMessageId) return addReply(where, message);
  queryClient.setQueryData<InfiniteData<Page>>(messageKeys.list(where), (data) => {
    if (!data) return data;
    const exists = data.pages.some((page) => page.messages.some((m) =>
      m.id === message.id || (message.clientMutationId && m.clientMutationId === message.clientMutationId)));
    if (exists) {
      return { ...data, pages: data.pages.map((page) => ({ ...page, messages: page.messages.map((m) =>
        m.id === message.id || (message.clientMutationId && m.clientMutationId === message.clientMutationId) ? { ...m, ...message, sending: false, failed: false } : m) })) };
    }
    const [newest, ...rest] = data.pages;
    return { ...data, pages: [{ ...newest, messages: [...newest.messages, message] }, ...rest] };
  });
}

/* Replies already counted on their parent's "N replies" line (our own echo and the live copy are the same reply). */
const countedReplies = new Set<string>();

function addReply(where: Thread, message: Message) {
  const parentId = message.parentMessageId!;
  queryClient.setQueryData<{ parent: Message; replies: Message[] }>(messageKeys.replies(where, parentId), (data) => {
    if (!data) return data;
    const index = data.replies.findIndex((m) => m.id === message.id || (message.clientMutationId && m.clientMutationId === message.clientMutationId));
    if (index >= 0) {
      const replies = [...data.replies];
      replies[index] = { ...replies[index], ...message, sending: false, failed: false };
      return { ...data, replies };
    }
    return { ...data, replies: [...data.replies, message] };
  });
  // The parent's "N replies" line, once per reply.
  if (!message.sending && !message.id.startsWith("local-") && !countedReplies.has(message.id)) {
    countedReplies.add(message.id);
    patchList(where, (m) => {
      if (m.id !== parentId) return m;
      const summary = m.threadSummary ?? { replyCount: 0, lastReplyAt: message.createdAt, repliers: [] };
      const repliers = [message.author, ...summary.repliers.filter((r) => r.id !== message.author.id)].slice(0, 3)
        .map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl }));
      return { ...m, threadSummary: { replyCount: summary.replyCount + 1, lastReplyAt: message.createdAt, repliers } };
    });
  }
}

export function removeMessage(where: Thread, id: string) {
  patchList(where, (m) => (m.id === id ? null : m));
  patchReplies(where, (m) => (m.id === id ? null : m));
}

/* ---------- Actions ---------- */

export async function sendMessage(where: Thread, input: {
  body: string;
  mentions?: { id: string; start: number; end: number }[];
  files?: Attachment[];
  parentMessageId?: string | null;
  replyToMessageId?: string | null;
}, me: Author) {
  const clientMutationId = crypto.randomUUID();
  const files = input.files ?? [];
  const optimistic: Message = {
    id: `local-${clientMutationId}`,
    clientMutationId,
    body: input.body.trim(),
    bodyHtml: null,
    attachments: files,
    mediaUrls: files.map((f) => f.url),
    parentMessageId: input.parentMessageId ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    author: me,
    reactions: {},
    sending: true,
  };
  addMessage(where, optimistic);
  try {
    const { message } = await api<{ message: Message }>(`${base(where)}/messages`, {
      method: "POST",
      body: {
        body: input.body,
        mediaUrls: files.map((f) => f.url),
        attachments: files,
        parentMessageId: input.parentMessageId ?? null,
        clientMutationId,
        ...(where.kind === "channel" ? { mentions: input.mentions ?? [] } : {}),
        ...(where.kind === "dm" && input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      },
    });
    addMessage(where, { ...message, clientMutationId });
    return true;
  } catch {
    patchMessage(where, optimistic.id, (m) => ({ ...m, sending: false, failed: true }));
    return false;
  }
}

export async function toggleReaction(where: Thread, message: Message, emoji: string) {
  const before = message.reactions ?? {};
  const current = before[emoji];
  const next: Reactions = { ...before };
  if (current?.mine) {
    if (current.count <= 1) delete next[emoji];
    else next[emoji] = { count: current.count - 1, mine: false };
  } else {
    next[emoji] = { count: (current?.count ?? 0) + 1, mine: true };
  }
  patchMessage(where, message.id, (m) => ({ ...m, reactions: next }));
  try {
    const { reactions } = await api<{ reactions: Reactions }>(`/api/messages/${message.id}/reactions`, { method: "POST", body: { emoji } });
    patchMessage(where, message.id, (m) => ({ ...m, reactions }));
  } catch {
    patchMessage(where, message.id, (m) => ({ ...m, reactions: before }));
  }
}

export async function editMessage(where: Thread, id: string, body: string) {
  const result = await api<{ body: string; bodyHtml: string; editedAt: string }>(`/api/messages/${id}`, { method: "PATCH", body: { body } });
  patchMessage(where, id, (m) => ({ ...m, body: result.body, bodyHtml: result.bodyHtml, editedAt: result.editedAt }));
}

export async function deleteMessage(where: Thread, id: string) {
  await api(`/api/messages/${id}`, { method: "DELETE" });
  removeMessage(where, id);
}

export async function markRead(where: Thread) {
  try {
    await api("/api/messages/read", { method: "POST", body: where.kind === "channel" ? { channelId: where.id } : { conversationId: where.id } });
  } catch {
    // The count fixes itself on the next read.
  }
}

/** Reaction counts from a live update keep our own "mine" flags. */
export function mergeCounts(before: Reactions | undefined, counts: Record<string, { count: number }>): Reactions {
  const next: Reactions = {};
  for (const [emoji, { count }] of Object.entries(counts)) next[emoji] = { count, mine: Boolean(before?.[emoji]?.mine) };
  return next;
}

/* ---------- Members (for mentions, profiles, the Members page) ---------- */

export interface Member {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  presence?: string;
  joinedAt?: string;
  bio?: string | null;
  headline?: string | null;
  location?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  youtube?: string | null;
  website?: string | null;
  badge?: MemberBadge | null;
}

export function useMembers(enabled = true) {
  return useQuery({
    queryKey: ["members"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => (await api<{ members: Member[] }>("/api/members")).members,
  });
}

export function useChannelMembers(channelId: string | null) {
  return useQuery({
    queryKey: ["channel-members", channelId],
    enabled: Boolean(channelId),
    staleTime: 5 * 60_000,
    queryFn: async () => api<{ members: Member[]; memberCount: number; canManage: boolean }>(`/api/channels/${channelId}/members`),
  });
}

/** Staff first, the way the website orders them. */
export const roleLabel = (role: string) => (role === "owner" ? "Owner" : role === "team" ? "Team" : "");
