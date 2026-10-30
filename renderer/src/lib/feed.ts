import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api, ApiError, queryClient, rateLimitMessage } from "./api";
import type { Author, Reactions, UploadedVideo, VideoAttachment } from "./community";

export const CATEGORIES = [
  { key: "general", label: "General", emoji: "💬", staffOnly: false },
  { key: "win", label: "Wins", emoji: "🏆", staffOnly: false },
  { key: "question", label: "Questions", emoji: "❓", staffOnly: false },
  { key: "introduction", label: "Intros", emoji: "👋", staffOnly: false },
  { key: "announcement", label: "Announcements", emoji: "📢", staffOnly: true },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const POST_REACTIONS = ["👏", "🔥", "💯", "❤️"];
export const categoryOf = (key: string) => CATEGORIES.find((c) => c.key === key);

export interface Poll {
  question: string;
  options: { id: string; label: string; votes: number }[];
  totalVotes: number;
  myVote: string | null;
}

export interface Post {
  id: string;
  body: string;
  mediaUrls: string[];
  filterTag: CategoryKey;
  pinned: boolean;
  reactionsCount: number;
  commentsCount: number;
  createdAt: string;
  editedAt: string | null;
  poll: Poll | null;
  reactions: Reactions;
  author: Author;
}

export interface Comment {
  id: string;
  body: string;
  deleted: boolean;
  parentCommentId: string | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  editedAt: string | null;
  author: Author;
  /** The people @mentioned in it (picked from the list), for highlighting "@Name". */
  mentions?: { id: string; name: string }[];
  /** Photos, files and GIPHY GIFs, in order (empty once deleted). */
  mediaUrls?: string[];
  /** At most one video, shaped like a channel message's. */
  videoAttachments?: VideoAttachment[];
}

interface Page {
  posts: Post[];
  nextCursor: string | null;
}

export const feedKey = (filter: string) => ["posts", filter] as const;

export function useFeed(filter: string) {
  return useInfiniteQuery({
    queryKey: feedKey(filter),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(`/api/posts?filter=${filter}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePinnedPosts() {
  return useQuery({ queryKey: ["posts", "pinned"], queryFn: async () => (await api<{ posts: Post[] }>("/api/feed-v2/pinned-posts")).posts });
}

export function usePost(id: string | null) {
  return useQuery({ queryKey: ["post", id], enabled: Boolean(id), queryFn: async () => (await api<{ post: Post }>(`/api/posts/${id}`)).post });
}

export function useComments(postId: string | null) {
  return useQuery({ queryKey: ["comments", postId], enabled: Boolean(postId), queryFn: async () => (await api<{ comments: Comment[] }>(`/api/posts/${postId}/comments`)).comments });
}

export function useUnreadCategories() {
  return useQuery({ queryKey: ["posts-unread"], queryFn: async () => (await api<{ counts: Record<string, number> }>("/api/posts/unread")).counts });
}

/** Change one post everywhere it's cached (each feed filter, pinned, the single post). */
export function patchPost(id: string, change: (post: Post) => Post | null) {
  for (const [key, data] of queryClient.getQueriesData<InfiniteData<Page> | Post[]>({ queryKey: ["posts"] })) {
    if (!data) continue;
    if (Array.isArray(data)) {
      queryClient.setQueryData(key, data.map((p) => (p.id === id ? change(p) : p)).filter(Boolean));
    } else {
      queryClient.setQueryData(key, { ...data, pages: data.pages.map((page) => ({ ...page, posts: page.posts.map((p) => (p.id === id ? change(p) : p)).filter(Boolean) as Post[] })) });
    }
  }
  queryClient.setQueryData<Post>(["post", id], (post) => (post ? change(post) ?? undefined : post));
}

export async function reactToPost(post: Post, emoji: string) {
  const before = post.reactions;
  const current = before[emoji];
  const optimistic: Reactions = { ...before };
  if (current?.mine) {
    if (current.count <= 1) delete optimistic[emoji];
    else optimistic[emoji] = { count: current.count - 1, mine: false };
  } else optimistic[emoji] = { count: (current?.count ?? 0) + 1, mine: true };
  patchPost(post.id, (p) => ({ ...p, reactions: optimistic }));
  try {
    const { reactions } = await api<{ reactions: Reactions }>(`/api/posts/${post.id}/reactions`, { method: "POST", body: { emoji } });
    patchPost(post.id, (p) => ({ ...p, reactions }));
  } catch (error) {
    patchPost(post.id, (p) => ({ ...p, reactions: before }));
    const limited = rateLimitMessage(error);
    if (limited) window.alert(limited);
  }
}

export async function vote(post: Post, optionId: string) {
  const { poll } = await api<{ poll: Poll }>(`/api/posts/${post.id}/poll`, { method: "POST", body: { optionId } });
  patchPost(post.id, (p) => ({ ...p, poll }));
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The feed stores HTML; the Mac composer writes paragraphs of plain text, with links made clickable. */
export function textToPostHtml(text: string) {
  return text.trim().split(/\n{2,}/).map((para) =>
    `<p>${escape(para).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, "<br>")}</p>`).join("");
}

export async function createPost(input: { text: string; category: CategoryKey; mediaUrls: string[]; poll?: { question: string; options: string[] } | null }) {
  const { post } = await api<{ post: Post }>("/api/posts", {
    method: "POST",
    body: { body: textToPostHtml(input.text), filterTag: input.category, mediaUrls: input.mediaUrls, poll: input.poll ?? undefined, clientMutationId: crypto.randomUUID() },
  });
  void queryClient.invalidateQueries({ queryKey: ["posts"] });
  return post;
}

/** Mux takes a moment to see a video's bytes: the comment is refused with 409 until then, as channel finalize is. */
async function postComment(postId: string, body: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<{ comment: Comment; commentsCount: number | null }>(`/api/posts/${postId}/comments`, { method: "POST", body });
    } catch (error) {
      if (!(body.videoUploadToken && error instanceof ApiError && error.status === 409 && attempt < 120)) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

export async function addComment(postId: string, body: string, parentCommentId: string | null, mentionIds: string[] = [], media: { mediaUrls?: string[]; videoUploadToken?: string } = {}) {
  const result = await postComment(postId, {
    body, parentCommentId, mentionIds, clientMutationId: crypto.randomUUID(),
    ...(media.mediaUrls?.length ? { mediaUrls: media.mediaUrls } : {}),
    ...(media.videoUploadToken ? { videoUploadToken: media.videoUploadToken } : {}),
  });
  queryClient.setQueryData<Comment[]>(["comments", postId], (list) => (list ? [...list, result.comment] : list));
  if (result.commentsCount !== null) patchPost(postId, (p) => ({ ...p, commentsCount: result.commentsCount! }));
  watchCommentVideos(postId, result.comment);
  return result.comment;
}

/* ---------- Comment attachments ----------
   Photos, files and GIFs are URLs (our Blob uploads, or GIPHY); a video goes
   to Mux through the comment's own upload-url, as a channel video does, and
   is sent alone as videoUploadToken. */

export const MAX_COMMENT_MEDIA = 4;

/** A comment video's bytes straight to Mux, with progress (uploadVideo in community.ts, aimed at a post). */
export async function uploadCommentVideo(postId: string, file: File, onProgress: (pct: number) => void): Promise<UploadedVideo> {
  const start = await api<{ uploadUrl: string; uploadToken: string; uid: string }>(`/api/posts/${postId}/comments/videos/upload-url`, {
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

const watchingVideos = new Set<string>();

/** Until Mux has made a comment's video playable, ask its status at the channel videos' cadence. */
export function watchCommentVideos(postId: string, comment: Comment) {
  for (const video of comment.videoAttachments ?? []) {
    if (video.status !== "processing" || watchingVideos.has(video.uid)) continue;
    watchingVideos.add(video.uid);
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const { videoAttachment } = await api<{ videoAttachment: VideoAttachment }>(`/api/posts/${postId}/comments/videos/${video.uid}`);
        queryClient.setQueryData<Comment[]>(["comments", postId], (list) => list?.map((c) => (c.id === comment.id
          ? { ...c, videoAttachments: c.videoAttachments?.map((v) => (v.uid === video.uid ? videoAttachment : v)) } : c)));
        if (videoAttachment.status !== "processing") { watchingVideos.delete(video.uid); return; }
      } catch { /* try again */ }
      if (tries < 200) setTimeout(() => void tick(), tries < 10 ? 1500 : 4000);
      else watchingVideos.delete(video.uid);
    };
    setTimeout(() => void tick(), 1200);
  }
}

/** A GIF picked from GIPHY (shown with a small "GIF" tag), as opposed to an uploaded picture. */
export function isGiphyUrl(url: string) {
  try {
    return /(^|\.)giphy\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export interface Gif { id: string; title: string; preview: string; url: string }

type GiphyImage = { url?: string } | undefined;

/** GIPHY through the website (GET /api/giphy/search; trending when q is empty), picked as the website's picker picks. */
export async function searchGifs(q: string): Promise<Gif[]> {
  const { data } = await api<{ data: { id?: string; title?: string; images?: Record<string, GiphyImage> }[] }>(`/api/giphy/search?q=${encodeURIComponent(q.trim().slice(0, 50))}`);
  return (data ?? []).flatMap((gif) => {
    const preview = gif.images?.fixed_width_small ?? gif.images?.fixed_width;
    const selected = gif.images?.downsized_medium ?? gif.images?.downsized ?? gif.images?.original;
    return gif.id && preview?.url && selected?.url ? [{ id: gif.id, title: gif.title ?? "GIF", preview: preview.url, url: selected.url }] : [];
  });
}

export async function likeComment(postId: string, comment: Comment) {
  queryClient.setQueryData<Comment[]>(["comments", postId], (list) => list?.map((c) => (c.id === comment.id
    ? { ...c, likedByMe: !c.likedByMe, likeCount: c.likeCount + (c.likedByMe ? -1 : 1) } : c)));
  try {
    await api(`/api/posts/${postId}/comments/${comment.id}/like`, { method: comment.likedByMe ? "DELETE" : "PUT" });
  } catch {
    void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
  }
}

/** Edit your own post: its formatted words (pictures and a poll stay as they are). The server sanitizes the HTML. */
export async function editPost(post: Post, html: string) {
  const { post: saved } = await api<{ post: { body: string; edited_at: string | null } }>(`/api/posts/${post.id}`, {
    method: "PATCH",
    body: { body: html },
  });
  patchPost(post.id, (p) => ({ ...p, body: saved.body, editedAt: saved.edited_at ?? p.editedAt }));
}

export async function editComment(postId: string, comment: Comment, body: string) {
  const { comment: saved } = await api<{ comment: { body: string; editedAt: string | null } }>(`/api/posts/${postId}/comments/${comment.id}`, {
    method: "PATCH",
    body: { body },
  });
  queryClient.setQueryData<Comment[]>(["comments", postId], (list) => list?.map((c) => (c.id === comment.id ? { ...c, body: saved.body, editedAt: saved.editedAt } : c)));
}

/**
 * The server decides what's left: a comment with replies stays as "Comment
 * deleted" with its replies under it, one without goes. So the list is read
 * again rather than guessed.
 */
export async function deleteComment(postId: string, comment: Comment) {
  try {
    const result = await api<{ commentsCount: number }>(`/api/posts/${postId}/comments/${comment.id}`, { method: "DELETE" });
    patchPost(postId, (p) => ({ ...p, commentsCount: result.commentsCount }));
  } catch (error) {
    // Already gone (another device, a moderator) is what was asked for.
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  await queryClient.invalidateQueries({ queryKey: ["comments", postId] });
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * A post's first paragraph or heading stands as its title when more words follow
 * it, as on the website (splitPostBody in app/page.tsx there). Same rule, so a
 * post's first line is a title on both or on neither.
 */
export function splitPostBody(html: string): { title: string | null; body: string } {
  const first = html.trim().match(/^<(p|h2|h3)\b[^>]*>[\s\S]*?<\/\1>/i);
  if (!first) return { title: null, body: html };
  const rest = html.trim().slice(first[0].length).trim();
  if (!plain(first[0]) || !plain(rest)) return { title: null, body: html };
  return { title: first[0], body: rest };
}

/** Pictures by their extension, as the website decides (isImageAttachmentUrl there); anything else is a file. */
export function isImageUrl(url: string) {
  try {
    return /\.(jpe?g|png|webp|gif)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A file's name from its storage URL, without the upload's timestamp and random suffix. */
export function attachmentName(url: string) {
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "Attachment");
    // Uploads are named "<timestamp>-<name>" and the store adds "-<random>"; show the name, as the website does.
    return segment.replace(/-[a-zA-Z0-9]{8,}(?=\.[^.]+$)/, "").replace(/^\d{12,}-(?=.)/, "") || "Attachment";
  } catch {
    return "Attachment";
  }
}

/* ---------- New posts while reading ----------
   feed:community says post:created with { postId, authorId, category }. While
   Home is open it decides what to do (insert at the top, or the "New posts"
   pill), so the feed never reorders under the reader; when it isn't, the
   feed is simply read again next time. */

export interface PostCreated { postId?: string; authorId?: string; category?: string }

const postCreatedListeners = new Set<(signal: PostCreated | null) => void>();

/** Home listens while it's open. */
export function onPostCreated(listener: (signal: PostCreated | null) => void) {
  postCreatedListeners.add(listener);
  return () => void postCreatedListeners.delete(listener);
}

/** From the realtime signal (data is null from older servers). False when nobody is listening. */
export function postCreated(signal: PostCreated | null) {
  postCreatedListeners.forEach((listener) => listener(signal));
  return postCreatedListeners.size > 0;
}

/** The newest page of a filter, without touching the cached feed. */
export const newestPosts = (filter: string) => api<Page>(`/api/posts?filter=${filter}&limit=20`).then((page) => page.posts);

/** Posts put at the top of a filter's cached feed (any already there are left where they are). */
export function prependPosts(filter: string, posts: Post[]) {
  queryClient.setQueryData<InfiniteData<Page>>(feedKey(filter), (data) => {
    if (!data?.pages.length) return data;
    const shown = new Set(data.pages.flatMap((page) => page.posts.map((p) => p.id)));
    const fresh = posts.filter((p) => !shown.has(p.id));
    if (!fresh.length) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first, posts: [...fresh, ...first.posts] }, ...rest] };
  });
}
