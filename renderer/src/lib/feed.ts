import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api, queryClient } from "./api";
import type { Author, Reactions } from "./community";

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
  } catch {
    patchPost(post.id, (p) => ({ ...p, reactions: before }));
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

export async function addComment(postId: string, body: string, parentCommentId: string | null) {
  const result = await api<{ comment: Comment; commentsCount: number | null }>(`/api/posts/${postId}/comments`, {
    method: "POST",
    body: { body, parentCommentId, clientMutationId: crypto.randomUUID() },
  });
  queryClient.setQueryData<Comment[]>(["comments", postId], (list) => (list ? [...list, result.comment] : list));
  if (result.commentsCount !== null) patchPost(postId, (p) => ({ ...p, commentsCount: result.commentsCount! }));
  return result.comment;
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
