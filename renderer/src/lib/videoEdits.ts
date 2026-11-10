import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, keys, queryClient, type Conversation } from "./api";
import { ch, type LocalVideoFile } from "./bridge";
import { nav } from "./nav";
import { setSubmissionState, useSubmission, type VideoSubmissionState } from "./starter";

/*
  The personal video editor ("frame.io inside the app"), creatorhive-app
  docs/video-editor.md. The types below are copied from the website's
  lib/improve/video-edit-types.ts; keep the two in step.

  Student: GET /api/improve/videos carries `submission.editing`; she comments on
  a moment, approves or asks for changes, and downloads the finals.
  Staff (owner + valentin@heysocial.ca; 404 for anyone else): the board, a card,
  versions uploaded straight to storage, replies that go to the DM.
*/

export const EDIT_STAGES = ["submitted", "in_editing", "ready_to_review", "revisions", "approved"] as const;
export type EditStage = (typeof EDIT_STAGES)[number];

export const EDIT_STAGE_LABELS: Record<EditStage, string> = {
  submitted: "Submitted",
  in_editing: "In editing",
  ready_to_review: "Ready to review",
  revisions: "Revisions",
  approved: "Approved",
};

/** The Hub stage palette: contract blue, production purple, pending honey, revisions orange, completed green. */
export const EDIT_STAGE_TONE: Record<EditStage, "contract" | "production" | "pending" | "revisions" | "completed"> = {
  submitted: "contract",
  in_editing: "production",
  ready_to_review: "pending",
  revisions: "revisions",
  approved: "completed",
};

/** The Hub's stage classes (app.css .s-*), so the colours are the same in light and dark. */
export const STAGE_CLASS: Record<EditStage, string> = {
  submitted: "s-deliverables_contract",
  in_editing: "s-production",
  ready_to_review: "s-pending_payment",
  revisions: "s-revisions",
  approved: "s-completed",
};

export type ReviewState = "pending" | "approved" | "changes_requested";

export interface EditPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface EditPlayback {
  hlsUrl: string;
  thumbnailUrl: string;
  playbackId: string;
  playbackToken: string;
  thumbnailToken: string;
}

export interface EditVersion {
  id: string;
  slot: number;
  version: number;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  note: string | null;
  createdAt: string;
  sentAt: string | null;
  playback: EditPlayback | null;
  viewUrl: string;
}

export interface EditComment {
  id: string;
  slot: number;
  editId: string | null;
  version: number | null;
  atSeconds: number | null;
  body: string;
  createdAt: string;
  author: EditPerson & { isEditor: boolean };
  resolvedInVersion: number | null;
}

export interface SlotReview {
  slot: number;
  state: ReviewState;
  editId: string | null;
  decidedAt: string | null;
}

export interface EditTimeline {
  submittedAt: string | null;
  inEditingAt: string | null;
  readyAt: string | null;
  revisionsAt: string | null;
  approvedAt: string | null;
}

export interface VideoEditor extends EditPerson {
  title: string;
  conversationId: string | null;
}

export interface StudentEditState {
  stage: EditStage | null;
  stageChangedAt: string | null;
  dueOn: string | null;
  brief: string | null;
  canReplace: boolean;
  timeline: EditTimeline;
  edits: EditVersion[];
  reviews: SlotReview[];
  comments: EditComment[];
  editor: VideoEditor | null;
  nextLine: string | null;
}

export interface BoardCard {
  id: string;
  stage: EditStage;
  stageChangedAt: string | null;
  submittedAt: string | null;
  dueOn: string | null;
  member: EditPerson & { plan: "first3" | "starter" | "other" };
  thumbnails: Array<{ slot: number; url: string | null }>;
  unread: number;
  progress: string;
  opened: boolean;
  approvedAt: string | null;
  sentAt: string | null;
}

export interface BoardResponse {
  cards: BoardCard[];
  counts: Record<EditStage, number>;
}

export interface StaffOriginal {
  id: string;
  slot: number;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  viewUrl: string;
  downloadUrl: string;
  playback: EditPlayback | null;
}

export interface StaffEditVersion extends EditVersion {
  downloadUrl: string;
  status: "uploading" | "ready";
}

export interface CardThreadItem {
  kind: "comment" | "message";
  id: string;
  at: string;
  author: EditPerson;
  body: string;
  slot: number | null;
  atSeconds: number | null;
  version: number | null;
}

export interface StaffCard {
  id: string;
  stage: EditStage;
  stageChangedAt: string | null;
  submittedAt: string | null;
  dueOn: string | null;
  brief: string | null;
  member: EditPerson & { email: string; plan: "first3" | "starter" | "other" };
  originals: StaffOriginal[];
  totalBytes: number;
  edits: StaffEditVersion[];
  reviews: SlotReview[];
  comments: EditComment[];
  thread: CardThreadItem[];
  conversationId: string | null;
  timeline: EditTimeline;
}

export interface EditUploadTicket {
  editId: string;
  version: number;
  uploadUrl: string;
  contentType: string;
}

/* ------------------------------------------------------------------ helpers (copied) */

export function stageIndex(stage: EditStage): number {
  return EDIT_STAGES.indexOf(stage);
}

export function isEditStage(value: unknown): value is EditStage {
  return typeof value === "string" && (EDIT_STAGES as readonly string[]).includes(value);
}

/** "0:21". */
export function formatMoment(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Days from today (Toronto) to a YYYY-MM-DD date: 0 today, negative overdue. */
export function daysUntil(dueOn: string, now = new Date(), timeZone = "America/Toronto"): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const b = Date.UTC(Number(dueOn.slice(0, 4)), Number(dueOn.slice(5, 7)) - 1, Number(dueOn.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** "Thu, Nov 13" from YYYY-MM-DD (a calendar date, no time zone shift). */
export function formatDueDate(dueOn: string, withWeekday = true): string {
  const date = new Date(`${dueOn}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric", timeZone: "UTC",
  }).format(date);
}

/* ------------------------------------------------------------------ Mac helpers */

/** "Nov 6" (or "Thu, Nov 6") from a timestamp. */
export function shortDay(iso: string | null | undefined, withWeekday = false) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { ...(withWeekday ? { weekday: "short" } : {}), month: "short", day: "numeric" });
}

/** "(in 3 days)", "(today)", "(2 days late)". */
export function dueIn(dueOn: string) {
  const days = daysUntil(dueOn);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "1 day late" : `${-days} days late`;
}

export const planLabel = (plan: string | null | undefined) => (plan === "first3" ? "Weekend Starter" : plan === "starter" ? "UGC Starter" : "Student");
export const firstName = (name: string) => name.split(" ")[0] || name;

/** Versions of one slot, newest first. */
export function versionsOf<T extends EditVersion>(edits: T[], slot: number): T[] {
  return edits.filter((e) => e.slot === slot).sort((a, b) => b.version - a.version);
}

function messageOf(error: unknown, fallback: string) {
  if (error instanceof ApiError && typeof error.data?.error === "string") return error.data.error;
  return fallback;
}

/* ------------------------------------------------------------------ student */

/** The student's side, from GET /api/improve/videos (the same query as the upload screen). */
export function useStudentEditing(enabled = true) {
  const query = useSubmission(enabled);
  return { ...query, state: query.data?.state ?? null, editing: query.data?.state?.editing ?? null };
}

function setEditing(editing: StudentEditState) {
  const current = queryClient.getQueryData<{ state: VideoSubmissionState | null; unavailable: string | null }>(["improve", "videos"]);
  if (current?.state) setSubmissionState({ ...current.state, editing });
}

export async function refreshStudentEditing() {
  await queryClient.invalidateQueries({ queryKey: ["improve", "videos"], exact: true });
}

export async function addStudentComment(input: { slot: number; editId: string; atSeconds: number | null; body: string }): Promise<string | null> {
  try {
    const { comments } = await api<{ comments: EditComment[] }>("/api/improve/videos/comments", {
      method: "POST",
      body: { slot: input.slot, editId: input.editId, ...(input.atSeconds == null ? {} : { atSeconds: Math.round(input.atSeconds * 100) / 100 }), body: input.body },
    });
    const current = queryClient.getQueryData<{ state: VideoSubmissionState | null }>(["improve", "videos"])?.state?.editing;
    if (current) setEditing({ ...current, comments });
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't add your note. Try again.");
  }
}

export async function deleteStudentComment(id: string): Promise<string | null> {
  try {
    await api(`/api/improve/videos/comments/${id}`, { method: "DELETE" });
    const current = queryClient.getQueryData<{ state: VideoSubmissionState | null }>(["improve", "videos"])?.state?.editing;
    if (current) setEditing({ ...current, comments: current.comments.filter((c) => c.id !== id) });
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't delete your note.");
  }
}

export async function reviewVideo(slot: number, decision: "approve" | "changes"): Promise<string | null> {
  try {
    const { editing } = await api<{ editing: StudentEditState }>(`/api/improve/videos/${slot}/review`, { method: "POST", body: { decision } });
    setEditing(editing);
    void queryClient.invalidateQueries({ queryKey: ["improve"], exact: true });
    return null;
  } catch (error) {
    return messageOf(error, decision === "approve" ? "Couldn't approve it. Try again." : "Couldn't send your notes. Try again.");
  }
}

const watched = new Set<string>();
/** The first play of a version tells Valentin it was watched ("Watched 2 of 3"). */
export function markWatched(slot: number, editId: string) {
  if (watched.has(editId)) return;
  watched.add(editId);
  void api(`/api/improve/videos/${slot}/watched`, { method: "POST" }).catch(() => watched.delete(editId));
}

/** The approved file at full quality, saved where she picks. */
export async function downloadFinal(slot: number): Promise<string | null> {
  try {
    const { url } = await api<{ url: string }>(`/api/improve/videos/${slot}/download?format=json`);
    const result = await ch.files.save(url, `Video ${slot} final.mp4`);
    return result.ok || result.canceled ? null : "The download didn't finish. Try again.";
  } catch (error) {
    return messageOf(error, "Couldn't get the final file. Try again.");
  }
}

/* The editor chat docked on Improve and the review screen: open or closed, kept while moving between the two. */
let chatOpen = false;
const chatListeners = new Set<() => void>();
export const editorChat = {
  open() { chatOpen = true; chatListeners.forEach((l) => l()); },
  close() { chatOpen = false; chatListeners.forEach((l) => l()); },
  toggle() { chatOpen = !chatOpen; chatListeners.forEach((l) => l()); },
};
export function useEditorChatOpen() {
  return useSyncExternalStore((l) => { chatListeners.add(l); return () => chatListeners.delete(l); }, () => chatOpen);
}

/** The DM with the editor: the one the server names, else started now (POST /api/dms). */
export async function editorConversation(editor: VideoEditor): Promise<string> {
  if (editor.conversationId) return editor.conversationId;
  const { conversation } = await api<{ conversation: Conversation }>("/api/dms", { method: "POST", body: { userId: editor.id, workspace: "creatorhive" } });
  await queryClient.invalidateQueries({ queryKey: keys.conversations("creatorhive") });
  void refreshStudentEditing();
  return conversation.id;
}

/* ------------------------------------------------------------------ staff */

export const BOARD_KEY = ["video-edits", "board"] as const;
const cardKey = (id: string) => ["video-edits", "card", id] as const;

/**
 * The board, or null for everyone it isn't for (the API answers 404). The rail
 * item, the Messages labels and the strip all follow this one query.
 */
export function useVideoEditsBoard(enabled = true) {
  return useQuery({
    queryKey: BOARD_KEY,
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data ? 60_000 : false),
    queryFn: async (): Promise<BoardResponse | null> => {
      try {
        const { cards, counts } = await api<BoardResponse>("/api/video-edits");
        return { cards, counts };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
        throw error;
      }
    },
  });
}

/** Staff see the board: the rail item shows. */
export function useCanSeeVideoEdits() {
  return Boolean(useVideoEditsBoard().data);
}

/** The board card for a student (by the DM's other person), for staff only. */
export function useCardForMember(memberId: string | null | undefined) {
  const board = useVideoEditsBoard(Boolean(memberId)).data;
  return memberId ? board?.cards.find((c) => c.member.id === memberId) ?? null : null;
}

export function useVideoEditCard(id: string | null) {
  return useQuery({
    queryKey: cardKey(id ?? ""),
    enabled: Boolean(id),
    staleTime: 20_000,
    // The presigned links last an hour.
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await api<{ card: StaffCard }>(`/api/video-edits/${id}`)).card,
  });
}

function putCard(card: StaffCard) {
  queryClient.setQueryData(cardKey(card.id), card);
  void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
}

/** Move a card (or change its due date). Refusals come back as the website's sentence. */
export async function patchCard(id: string, patch: { stage?: EditStage; dueOn?: string }): Promise<string | null> {
  const board = queryClient.getQueryData<BoardResponse | null>(BOARD_KEY);
  if (board && patch.stage) {
    // On the board at once; the server's answer replaces it.
    queryClient.setQueryData<BoardResponse | null>(BOARD_KEY, <BoardResponse>{
      ...board,
      cards: board.cards.map((c) => (c.id === id ? { ...c, stage: patch.stage!, stageChangedAt: new Date().toISOString() } : c)),
    });
  }
  try {
    const { card } = await api<{ card: StaffCard }>(`/api/video-edits/${id}`, { method: "PATCH", body: patch });
    putCard(card);
    return null;
  } catch (error) {
    if (board) queryClient.setQueryData(BOARD_KEY, board);
    void queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    if (error instanceof ApiError && error.data?.code === "NEEDS_VERSIONS" && typeof error.data.error !== "string") {
      return "Each of the 3 videos needs an edited version before it's ready to review.";
    }
    return messageOf(error, "Couldn't move the card. Try again.");
  }
}

export async function staffComment(id: string, body: { slot: number; editId?: string | null; atSeconds?: number | null; body: string } | { resolveCommentId: string; resolvedInEditId: string | null }): Promise<string | null> {
  try {
    await api(`/api/video-edits/${id}/comments`, { method: "POST", body });
    await queryClient.invalidateQueries({ queryKey: cardKey(id) });
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't save that. Try again.");
  }
}

/** A reply from the card: it goes to the DM, as Messages sends it. */
export async function replyToStudent(cardId: string, conversationId: string, body: string): Promise<string | null> {
  try {
    await api(`/api/dms/${conversationId}/messages`, { method: "POST", body: { body, clientMutationId: crypto.randomUUID() } });
    await queryClient.invalidateQueries({ queryKey: cardKey(cardId) });
    void queryClient.invalidateQueries({ queryKey: ["messages"] });
    void queryClient.invalidateQueries({ queryKey: keys.conversations("creatorhive") });
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't send your reply. Try again.");
  }
}

/* Edited versions uploading: kept outside React, so they carry on while Valentin looks at another card. */

export interface VersionUpload {
  key: string;
  cardId: string;
  slot: number;
  name: string;
  size: number;
  sent: number;
  status: "uploading" | "finishing" | "failed";
  error: string | null;
  editId: string | null;
  version: number | null;
}

let versionUploads: Record<string, VersionUpload> = {};
const uploadListeners = new Set<() => void>();
const setUpload = (key: string, patch: Partial<VersionUpload> | null) => {
  const next = { ...versionUploads };
  if (patch === null) delete next[key];
  else next[key] = { ...next[key], ...patch } as VersionUpload;
  versionUploads = next;
  uploadListeners.forEach((l) => l());
};
let progressHooked = false;

export function useVersionUploads() {
  return useSyncExternalStore((l) => { uploadListeners.add(l); return () => uploadListeners.delete(l); }, () => versionUploads);
}

export const uploadKey = (cardId: string, slot: number) => `${cardId}:${slot}`;

export async function uploadVersion(cardId: string, slot: number, file: LocalVideoFile, note: string, meta?: { durationSeconds: number | null; width: number | null; height: number | null }) {
  if (!progressHooked) {
    progressHooked = true;
    ch.files.onPutProgress(({ id, sent }) => {
      const entry = Object.values(versionUploads).find((u) => u.editId === id);
      if (entry && entry.status === "uploading") setUpload(entry.key, { sent });
    });
  }
  const key = uploadKey(cardId, slot);
  if (versionUploads[key]?.status === "uploading") return;
  setUpload(key, { key, cardId, slot, name: file.name, size: file.size, sent: 0, status: "uploading", error: null, editId: null, version: null });
  try {
    const lower = file.name.toLowerCase();
    const mimeType = lower.endsWith(".mov") ? "video/quicktime" : lower.endsWith(".webm") ? "video/webm" : lower.endsWith(".m4v") ? "video/x-m4v" : "video/mp4";
    const { ticket } = await api<{ ticket: EditUploadTicket }>(`/api/video-edits/${cardId}/edits`, {
      method: "POST",
      body: { slot, fileName: file.name, sizeBytes: file.size, mimeType, ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}), ...(meta ?? {}) },
    });
    setUpload(key, { editId: ticket.editId, version: ticket.version });
    const put = await ch.files.putFile({ id: ticket.editId, url: ticket.uploadUrl, type: ticket.contentType, filePath: file.path });
    if (!put.ok) {
      setUpload(key, { status: "failed", error: put.error === "cancelled" ? "Cancelled." : "The upload stopped. Check your connection and try again." });
      return;
    }
    setUpload(key, { status: "finishing", sent: file.size });
    const { card } = await api<{ card: StaffCard }>(`/api/video-edits/${cardId}/edits/${ticket.editId}/complete`, { method: "POST" });
    putCard(card);
    setUpload(key, null);
  } catch (error) {
    setUpload(key, { status: "failed", error: messageOf(error, "The upload didn't work. Try again.") });
  }
}

export function cancelVersionUpload(key: string) {
  const entry = versionUploads[key];
  if (!entry) return;
  if (entry.editId && entry.status === "uploading") ch.files.cancelPut(entry.editId);
  setUpload(key, null);
}

export function openCard(cardId: string) {
  nav.open({ kind: "video-edits", cardId }, "edits", "ch");
}
