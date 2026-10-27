import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, queryClient } from "./api";
import { ch } from "./bridge";
import { messageKeys } from "./community";
import { openLocation, openPath } from "./links";

/*
  CreatorHive's Activity (the bell): everything aimed at me — @mentions in
  channels (old threads included), replies in threads I'm part of, reactions,
  comments and comment @mentions — and the threads I'm in. The server keeps
  the list and its read state, shared by the website, iPhone and Mac.
  Types copied from the website's lib/activity/types.ts.
*/

export type ActivityFilter = "all" | "mentions" | "threads" | "reactions";

export interface ActivityPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Where clicking an item goes: the thread or post scrolled to `messageId` / `commentId`, highlighted. */
export type ActivityTarget =
  | { kind: "channel"; channelId: string; channelSlug: string; threadId: string | null; messageId: string }
  | { kind: "dm"; conversationId: string; threadId: string | null; messageId: string }
  | { kind: "post"; postId: string; commentId: string | null }
  | { kind: "link" };

export interface ActivityItem {
  /** Stable across devices; send it back to mark the item read. */
  key: string;
  /** The filter it belongs to; "other" (announcements) shows under All only. */
  kind: "mention" | "thread" | "reaction" | "other";
  /** mention | thread_reply | reaction | post_comment | comment_reply | post_reaction | post_mention | comment_mention | announcement */
  type: string;
  at: string;
  unread: boolean;
  actor: ActivityPerson | null;
  /** Plain text, ready to show: "Tara mentioned you in #video-examples". */
  title: string;
  /** The message, comment or post it is about, as plain text. */
  preview: string;
  emoji: string | null;
  /** A thread item: replies you haven't read. */
  newReplies: number | null;
  /** "#video-examples", "Feed" or "Direct message". */
  place: string;
  target: ActivityTarget;
  /** The website's path for it (also what pushes carry). */
  link: string;
}

export interface ActivityThread {
  parentId: string;
  channelId: string;
  channelSlug: string;
  place: string;
  author: ActivityPerson;
  preview: string;
  createdAt: string;
  replyCount: number;
  newReplies: number;
  unread: boolean;
  repliers: string[];
  lastReply: { id: string; at: string; author: ActivityPerson; preview: string } | null;
  link: string;
}

interface ActivityList { unread: number; items: ActivityItem[] }

export const ACTIVITY_KEY = ["activity"] as const;
const listKey = (filter: ActivityFilter) => [...ACTIVITY_KEY, "list", filter] as const;
const THREADS_KEY = [...ACTIVITY_KEY, "threads"] as const;

export function useActivity(filter: ActivityFilter = "all", enabled = true) {
  return useQuery({
    queryKey: listKey(filter),
    enabled,
    queryFn: async () => {
      const { unread, items } = await api<ActivityList>(`/api/activity?filter=${filter}`);
      return { unread, items };
    },
  });
}

export function useActivityThreads(enabled = true) {
  return useQuery({
    queryKey: THREADS_KEY,
    enabled,
    queryFn: async () => (await api<{ threads: ActivityThread[] }>("/api/activity/threads")).threads,
  });
}

/** The bell's badge: `unread` counts every filter, so the All list carries it. */
export function useActivityUnread() {
  return useActivity("all").data?.unread ?? 0;
}

/** Fresh again when the window comes back (the list also follows notifications:changed, realtime.ts). */
export function useActivityRefresh() {
  useEffect(() => ch.window.onFocus((focused) => {
    if (focused) void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  }), []);
}

function refresh() {
  void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY });
  ch.app.refreshBadge();
}

/** Read on every list at once, before the server answers. */
function markLocally(isRead: (item: ActivityItem) => boolean) {
  for (const [key, data] of queryClient.getQueriesData<ActivityList>({ queryKey: [...ACTIVITY_KEY, "list"] })) {
    if (!data) continue;
    let dropped = 0;
    const items = data.items.map((item) => {
      if (!item.unread || !isRead(item)) return item;
      dropped += 1;
      return { ...item, unread: false, newReplies: item.newReplies ? 0 : item.newReplies };
    });
    queryClient.setQueryData<ActivityList>(key, { unread: Math.max(0, data.unread - dropped), items });
  }
}

export async function markActivityRead(keys: string[]) {
  if (!keys.length) return;
  const set = new Set(keys);
  markLocally((item) => set.has(item.key));
  try {
    await api("/api/activity", { method: "POST", body: { keys } });
  } finally {
    refresh();
  }
}

export async function markAllActivityRead() {
  markLocally(() => true);
  queryClient.setQueryData<ActivityThread[]>(THREADS_KEY, (list) => list?.map((t) => ({ ...t, unread: false, newReplies: 0 })));
  try {
    await api("/api/activity", { method: "POST", body: { all: true } });
  } finally {
    refresh();
  }
}

/** Open what an item is about: the thread at the message, the channel at the message, the post at the comment, the DM at the message. */
export function openActivityTarget(target: ActivityTarget, link: string) {
  switch (target.kind) {
    case "channel":
      if (target.threadId) dropThreadCache(target.channelId, target.threadId);
      openLocation({ ws: "ch", section: "home", view: { kind: "channel", id: target.channelId, threadId: target.threadId ?? undefined, messageId: target.messageId } });
      return;
    case "dm":
      // CreatorHive DMs reply inline: the message itself shows, in the conversation.
      openLocation({ ws: "ch", section: "home", view: { kind: "dm", id: target.conversationId, messageId: target.messageId } });
      return;
    case "post":
      openLocation({ ws: "ch", section: "home", view: { kind: "feed", postId: target.postId, commentId: target.commentId ?? undefined } });
      return;
    default:
      void openPath(link);
  }
}

export function openActivityItem(item: ActivityItem) {
  if (item.unread) void markActivityRead([item.key]).catch(() => {});
  openActivityTarget(item.target, item.link);
}

export function openActivityThread(thread: ActivityThread) {
  // Opening the thread (its replies) is what reads it on the server; locally it's read now.
  queryClient.setQueryData<ActivityThread[]>(THREADS_KEY, (list) => list?.map((t) => (t.parentId === thread.parentId ? { ...t, unread: false, newReplies: 0 } : t)));
  markLocally((item) => item.kind === "thread" && item.target.kind === "channel" && item.target.threadId === thread.parentId);
  openActivityTarget({ kind: "channel", channelId: thread.channelId, channelSlug: thread.channelSlug, threadId: thread.parentId, messageId: thread.lastReply?.id ?? thread.parentId }, thread.link);
  // The replies request reads it; the lists catch up once it has.
  setTimeout(refresh, 1500);
}

/**
 * A thread opened from Activity loads its replies fresh: the reply to show
 * may be newer than the cached copy, and the request is what tells the
 * server the thread has been read.
 */
function dropThreadCache(channelId: string, parentId: string) {
  void queryClient.invalidateQueries({ queryKey: messageKeys.replies({ kind: "channel", id: channelId }, parentId), refetchType: "all" });
}
