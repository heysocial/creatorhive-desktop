import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api, ApiError, queryClient, rateLimitMessage } from "./api";

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
  processingPct?: number | null;
  /** Client-only: still uploading from this Mac, 0–100. */
  uploadProgress?: number | null;
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
  /** Client-only: the website's sentence when it refused for going over a limit. */
  failedReason?: string;
}

export interface Page {
  messages: Message[];
  nextCursor: string | null;
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

/**
 * Sends to one conversation go out one after another, in the order they were
 * made, so a quick run of messages lands in the order it was typed. Each
 * message still shows the moment it's sent (its optimistic copy); only the
 * request waits for the one before it.
 */
const sendQueues = new Map<string, Promise<unknown>>();

function inOrder<T>(where: Thread, request: () => Promise<T>): Promise<T> {
  const key = `${where.kind}:${where.id}`;
  const run = (sendQueues.get(key) ?? Promise.resolve()).then(request, request);
  sendQueues.set(key, run.catch(() => undefined));
  return run;
}

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
    const { message } = await inOrder(where, () => api<{ message: Message }>(`${base(where)}/messages`, {
      method: "POST",
      body: {
        body: input.body,
        mediaUrls: files.map((f) => f.url),
        attachments: files,
        parentMessageId: input.parentMessageId ?? null,
        clientMutationId,
        // Channels, and Hey Social DMs (CreatorHive DMs ignore them).
        ...(where.kind === "channel" || input.mentions?.length ? { mentions: input.mentions ?? [] } : {}),
        ...(where.kind === "dm" && input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      },
    }));
    addMessage(where, { ...message, clientMutationId });
    return true;
  } catch (error) {
    patchMessage(where, optimistic.id, (m) => ({ ...m, sending: false, failed: true, failedReason: rateLimitMessage(error) ?? undefined }));
    return false;
  }
}

/* ---------- Videos (Mux), the way the website sends them ----------
   1. upload-url hands out a Mux upload URL for this one file;
   2. the bytes go straight to Mux (it allows any origin), with progress;
   3. finalize turns the uploaded videos into a message;
   4. Mux processes it; the message shows "Processing" until it can play. */

/** Posters made on this Mac for videos sent from it, by Mux uid. */
export const localPosters = new Map<string, string>();

export interface UploadedVideo { uploadToken: string; uid: string; name: string }

/** A video on its way to Mux. Sending doesn't wait for it: the message waits instead, showing its progress. */
export interface VideoJob {
  name: string;
  preview: string | null;
  duration: number;
  progress: number;
  done: Promise<UploadedVideo>;
  uploaded: UploadedVideo | null;
  failed: boolean;
  /** The website's sentence when it refused the upload for going over a limit. */
  failedReason?: string;
  subscribe(listener: () => void): () => void;
}

export function startVideoJob(file: File, upload: (file: File, onProgress: (pct: number) => void) => Promise<UploadedVideo>): VideoJob {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const job: VideoJob = {
    name: file.name, preview: null, duration: 0, progress: 0, uploaded: null, failed: false,
    done: Promise.resolve() as unknown as Promise<UploadedVideo>,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  job.done = upload(file, (pct) => { job.progress = pct; emit(); })
    .then((uploaded) => { job.uploaded = uploaded; job.progress = 100; emit(); return uploaded; })
    .catch((error) => { job.failed = true; job.failedReason = rateLimitMessage(error) ?? undefined; emit(); throw error; });
  job.done.catch(() => {});
  return job;
}

export async function uploadVideo(where: Thread, file: File, onProgress: (pct: number) => void): Promise<UploadedVideo> {
  const start = await api<{ uploadUrl: string; uploadToken: string; uid: string }>(`${base(where)}/videos/upload-url`, {
    method: "POST",
    body: { fileName: file.name, mimeType: file.type || "video/mp4", sizeBytes: file.size, providers: ["mux"] },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", start.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(file);
  });
  onProgress(100);
  return { uploadToken: start.uploadToken, uid: start.uid, name: file.name };
}

/** Mux takes a moment to see the bytes: finalize answers 409 until then. */
async function finalize(where: Thread, body: Record<string, unknown>) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      return await api<{ message: Message }>(`${base(where)}/videos/finalize`, { method: "POST", body });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409 && !String(error.code).includes("ALREADY"))) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("video never finished uploading");
}

/**
 * Send a message with videos right away: it appears at once with each video's
 * picture and upload progress, and becomes the real message when the uploads finish.
 */
export async function sendVideoJobs(where: Thread, input: { jobs: VideoJob[]; body: string; mentions?: { id: string; start: number; end: number }[]; parentMessageId?: string | null }, me: Author) {
  const clientMutationId = crypto.randomUUID();
  const localId = `local-${clientMutationId}`;
  const placeholder = (): VideoAttachment[] => input.jobs.map((job, i) => ({
    uid: `local-${clientMutationId}-${i}`, fileName: job.name, durationSeconds: job.duration || null, thumbnailUrl: job.preview, embedUrl: "",
    status: "processing", uploadProgress: job.uploaded ? null : job.progress,
  }));
  addMessage(where, {
    id: localId, clientMutationId, body: input.body.trim(), bodyHtml: null, mediaUrls: [], parentMessageId: input.parentMessageId ?? null,
    createdAt: new Date().toISOString(), editedAt: null, author: me, reactions: {}, sending: true,
    videoAttachment: placeholder()[0], videoAttachments: placeholder(),
  });
  const offs = input.jobs.map((job) => job.subscribe(() => patchMessage(where, localId, (m) => ({ ...m, videoAttachment: placeholder()[0], videoAttachments: placeholder() }))));
  try {
    const videos = await Promise.all(input.jobs.map((j) => j.done));
    // Mux makes its own poster a little later; until then the frame taken on this Mac stands in.
    videos.forEach((v, i) => { if (input.jobs[i].preview) localPosters.set(v.uid, input.jobs[i].preview!); });
    removeMessage(where, localId);
    await sendVideos(where, { ...input, videos });
    return true;
  } catch (error) {
    const failedReason = rateLimitMessage(error) ?? input.jobs.find((job) => job.failedReason)?.failedReason;
    patchMessage(where, localId, (m) => ({ ...m, sending: false, failed: true, failedReason }));
    return false;
  } finally {
    offs.forEach((off) => off());
  }
}

export async function sendVideos(where: Thread, input: { videos: UploadedVideo[]; body: string; mentions?: { id: string; start: number; end: number }[]; parentMessageId?: string | null }) {
  const sent: Message[] = [];
  if (where.kind === "channel") {
    const { message } = await finalize(where, { uploadTokens: input.videos.map((v) => v.uploadToken), body: input.body, mentions: input.mentions ?? [], clientMutationId: crypto.randomUUID(), parentMessageId: input.parentMessageId ?? null });
    sent.push(message);
  } else {
    for (const [i, video] of input.videos.entries()) {
      const { message } = await finalize(where, { uploadToken: video.uploadToken, body: i === 0 ? input.body : "", clientMutationId: crypto.randomUUID() });
      sent.push(message);
    }
  }
  for (const message of sent) {
    addMessage(where, message);
    watchVideos(where, message);
  }
}

const watching = new Set<string>();

/** Until Mux has made a video playable, ask its status every few seconds and update the message. */
export function watchVideos(where: Thread, message: Message) {
  const videos = message.videoAttachments?.length ? message.videoAttachments : message.videoAttachment ? [message.videoAttachment] : [];
  for (const video of videos) {
    if (video.status !== "processing" || video.uid.startsWith("local-") || watching.has(video.uid)) continue;
    watching.add(video.uid);
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const { videoAttachment } = await api<{ videoAttachment: VideoAttachment }>(`${base(where)}/videos/${video.uid}`);
        patchMessage(where, message.id, (m) => ({
          ...m,
          videoAttachment: m.videoAttachment?.uid === video.uid ? videoAttachment : m.videoAttachment,
          videoAttachments: m.videoAttachments?.map((v) => (v.uid === video.uid ? videoAttachment : v)),
        }));
        if (videoAttachment.status !== "processing") { watching.delete(video.uid); return; }
      } catch { /* try again */ }
      if (tries < 200) setTimeout(() => void tick(), tries < 10 ? 1500 : 4000);
    };
    setTimeout(() => void tick(), 1200);
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
  } catch (error) {
    patchMessage(where, message.id, (m) => ({ ...m, reactions: before }));
    // Otherwise a failed reaction just quietly undoes itself, as before.
    const limited = rateLimitMessage(error);
    if (limited) window.alert(limited);
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
  for (const [emoji, { count }] of Object.entries(counts)) if (count > 0) next[emoji] = { count, mine: Boolean(before?.[emoji]?.mine) };
  return next;
}

/** Whether live counts differ from what's shown: a change this window didn't make. */
export function countsChanged(before: Reactions | undefined, counts: Record<string, { count: number }>) {
  const shown = Object.entries(before ?? {}).filter(([, r]) => r.count > 0);
  const live = Object.entries(counts).filter(([, r]) => r.count > 0);
  return shown.length !== live.length || live.some(([emoji, { count }]) => before?.[emoji]?.count !== count);
}

const reactionRefresh = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Live counts don't say whose they are, so a reaction made in another window,
 * on the website or on iPhone asks the server which ones are ours (debounced per message).
 */
export function refreshReactions(where: Thread, messageId: string) {
  clearTimeout(reactionRefresh.get(messageId));
  reactionRefresh.set(messageId, setTimeout(() => {
    reactionRefresh.delete(messageId);
    void api<{ reactions: Reactions }>(`/api/messages/${messageId}/reactions`)
      .then(({ reactions }) => patchMessage(where, messageId, (m) => ({ ...m, reactions })))
      .catch(() => {});
  }, 300));
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

/** Everyone in Hey Social Inc. but me, for its `@` list: channels there are often just a few people. */
export function useHsMembers(enabled = true) {
  return useQuery({
    queryKey: ["members", "heysocial"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => (await api<{ members: Member[] }>("/api/members?view=picker&workspace=heysocial&limit=40")).members,
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
