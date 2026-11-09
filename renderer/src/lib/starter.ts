import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "./api";
import { ch, type LocalVideoFile } from "./bridge";

/*
  UGC Starter's Improve: the five-step track and "Submit your 3 videos".
  Copied from creatorhive-app lib/improve/starter-types.ts (docs/starter-track.md);
  keep the two in step.
*/

export type StarterGrade = "A" | "B" | "C" | "–";
export type StarterStepId = "first_video" | "three_videos" | "applications" | "brand_reply" | "paid_deal";

export interface StarterStep {
  id: StarterStepId;
  number: number;
  title: string;
  state: "done" | "current" | "upcoming";
  grade: StarterGrade;
  completedAt: string | null;
  daysTaken: number | null;
  count: { value: number; target: number } | null;
  detail: string;
  stuck: string | null;
}

export interface StarterTrack {
  /** The heading: "Your first 3 videos" on The Weekend Starter (two steps; no Hub). Older servers leave it out. */
  title?: string;
  steps: StarterStep[];
  overallGrade: StarterGrade;
  currentStep: number;
  allDone: boolean;
  scriptWriter: { used: number; limit: number; remaining: number; resetsAt: string };
  upgradeUrl: string;
  /** Which plan the track is for: UGC Starter, or The Weekend Starter ("first3" inside). Older servers leave it out. */
  plan?: "starter" | "first3";
}

export const STARTER_GRADE_HELP = "A: done on pace · B: done, a bit slower · C: in progress, behind pace · –: not started yet.";

export interface SubmissionVideo {
  id: string;
  slot: number;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  previewUrl: string;
}

export interface VideoSubmissionState {
  status: "draft" | "submitted";
  submittedAt: string | null;
  videos: SubmissionVideo[];
  maxBytes: number;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function resetsLabel(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

const SUBMISSION_KEY = ["improve", "videos"] as const;

/** Null when uploads are switched off (503 UNAVAILABLE) or not for this member. */
export function useSubmission(enabled = true) {
  return useQuery({
    queryKey: SUBMISSION_KEY,
    enabled,
    retry: false,
    // The preview links last an hour; refresh well inside it.
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        return { state: (await api<{ submission: VideoSubmissionState }>("/api/improve/videos")).submission, unavailable: null as string | null };
      } catch (error) {
        if (error instanceof ApiError && (error.status === 503 || error.status === 403)) {
          return { state: null, unavailable: typeof error.data?.error === "string" ? error.data.error : "Uploads aren't available right now. Try again later." };
        }
        throw error;
      }
    },
  });
}

function setSubmission(state: VideoSubmissionState) {
  queryClient.setQueryData(SUBMISSION_KEY, { state, unavailable: null });
  void queryClient.invalidateQueries({ queryKey: ["improve"], exact: true });
}

export async function markFirstVideo(done: boolean) {
  await api("/api/improve/starter/first-video", { method: "POST", body: { done } });
  await queryClient.invalidateQueries({ queryKey: ["improve"], exact: true });
}

/* ---------- Uploads in flight: kept outside React, so they carry on while the member looks elsewhere ---------- */

export interface SlotUpload {
  slot: number;
  name: string;
  size: number;
  sent: number;
  status: "uploading" | "finishing" | "failed";
  meta?: VideoMeta;
  error: string | null;
  videoId: string | null;
  file: LocalVideoFile;
}

let uploads: Record<number, SlotUpload> = {};
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const update = (slot: number, patch: Partial<SlotUpload> | null) => {
  const next = { ...uploads };
  if (patch === null) delete next[slot];
  else next[slot] = { ...next[slot], ...patch } as SlotUpload;
  uploads = next;
  emit();
};

let progressHooked = false;
function hookProgress() {
  if (progressHooked) return;
  progressHooked = true;
  ch.files.onPutProgress(({ id, sent }) => {
    const entry = Object.values(uploads).find((u) => u.videoId === id);
    if (entry && entry.status === "uploading") update(entry.slot, { sent });
  });
}

export function useSlotUploads() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => uploads,
  );
}

function messageOf(error: unknown, fallback: string) {
  if (error instanceof ApiError && typeof error.data?.error === "string") return error.data.error;
  return fallback;
}

export interface VideoMeta { durationSeconds: number | null; width: number | null; height: number | null }

/** Length and size from the file itself, as the website reads them: best effort, 4 s at most. */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const empty = { durationSeconds: null, width: null, height: null };
    let url: string;
    try { url = URL.createObjectURL(file); } catch { resolve(empty); return; }
    const video = document.createElement("video");
    let settled = false;
    const finish = (meta: VideoMeta) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => finish(empty), 4000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish({
      durationSeconds: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      width: video.videoWidth || null,
      height: video.videoHeight || null,
    });
    video.onerror = () => finish(empty);
    video.src = url;
  });
}

export async function uploadToSlot(slot: number, file: LocalVideoFile, meta?: VideoMeta) {
  hookProgress();
  if (uploads[slot]?.status === "uploading") return;
  update(slot, { slot, name: file.name, size: file.size, sent: 0, status: "uploading", error: null, videoId: null, file, meta });
  let videoId: string | null = null;
  try {
    const { ticket } = await api<{ ticket: { videoId: string; uploadUrl: string; contentType: string } }>("/api/improve/videos/uploads", {
      method: "POST",
      body: { slot, fileName: file.name, mimeType: "", sizeBytes: file.size, ...(meta ?? {}) },
    });
    videoId = ticket.videoId;
    if (!uploads[slot]) {
      // Cancelled while the ticket was on its way.
      void api(`/api/improve/videos/${videoId}`, { method: "DELETE" }).catch(() => undefined);
      return;
    }
    update(slot, { videoId });
    const put = await ch.files.putFile({ id: videoId, url: ticket.uploadUrl, type: ticket.contentType, filePath: file.path });
    if (!uploads[slot]) return;
    if (!put.ok) {
      if (put.error === "cancelled") return;
      update(slot, { status: "failed", error: "The upload stopped. Check your connection and try again." });
      return;
    }
    update(slot, { status: "finishing", sent: file.size });
    const { submission } = await api<{ submission: VideoSubmissionState }>(`/api/improve/videos/uploads/${videoId}/complete`, { method: "POST" });
    setSubmission(submission);
    update(slot, null);
  } catch (error) {
    if (uploads[slot]) update(slot, { status: "failed", error: messageOf(error, "The upload didn't work. Try again.") });
  }
}

export function cancelSlot(slot: number) {
  const entry = uploads[slot];
  if (!entry) return;
  update(slot, null);
  if (entry.videoId) {
    ch.files.cancelPut(entry.videoId);
    void api<{ submission: VideoSubmissionState }>(`/api/improve/videos/${entry.videoId}`, { method: "DELETE" })
      .then(({ submission }) => setSubmission(submission)).catch(() => undefined);
  }
}

export function dismissSlotError(slot: number) {
  if (uploads[slot]?.status === "failed") update(slot, null);
}

export async function submitForEditing(): Promise<string | null> {
  try {
    const { submission } = await api<{ submission: VideoSubmissionState }>("/api/improve/videos/submit", { method: "POST" });
    setSubmission(submission);
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't submit your videos. Try again.");
  }
}

/*
  The 10 Improve resources, as creatorhive-app lib/improve/resources.ts lists
  them. Starter can't read their content (/api/improve/resources/content is the
  Academy's), but sees every tile: the Script Writer open, the rest locked.
*/
export const STARTER_RESOURCES = [
  { id: "ai-script-writer", slug: "ai-script-writer", title: "AI Script Writer", description: "Custom AI that writes your UGC scripts", type: "TOOL", icon: "sparkles", flagship: true, mode: "embed" },
  { id: "plug-and-play-email-scripts", slug: "plug-and-play-email-scripts", title: "Plug-and-Play Email Scripts", description: "Follow-up emails with subject lines + body", type: "DOC", icon: "mail", mode: "content" },
  { id: "10-video-prompts-challenge", slug: "10-video-prompts-challenge", title: "10 Video Prompts Challenge", description: "Build camera confidence with 10 guided videos", type: "DOC", icon: "camera", mode: "content" },
  { id: "bulletproof-script-prompt-template", slug: "bulletproof-script-prompt-template", title: "Bulletproof Script Prompt Template", description: "Loom walkthrough + reusable template", type: "VIDEO", icon: "template", mode: "content" },
  { id: "brand-outreach-manual", slug: "brand-outreach-manual", title: "Brand Outreach Manual", description: "How to reach brands, step by step", type: "VIDEO", icon: "outreach", mode: "content" },
  { id: "ugc-glossary", slug: "ugc-glossary", title: "UGC Glossary", description: "Every UGC term explained", type: "DOC", icon: "glossary", mode: "content" },
  { id: "templated-scripts", slug: "templated-scripts", title: "Templated Scripts", description: "Proven scripts + templates to adapt", type: "DOC", icon: "scripts", mode: "content" },
  { id: "agencies-and-platforms", slug: "agencies-and-platforms", title: "Agencies & Platforms", description: "Vetted agencies and platforms to find paid UGC work", type: "LIST", icon: "directory", mode: "content" },
  { id: "camera-settings-manual-iphone", slug: "camera-settings-manual-iphone", title: "Camera Settings Manual (iPhone Only)", description: "Exact iPhone settings for filming pro-quality UGC", type: "DOC", icon: "iphone", mode: "content" },
  { id: "cold-email-subject-lines-hooks-ctas", slug: "cold-email-subject-lines-hooks-ctas", title: "Cold Email Subject Lines, Hooks & CTAs", description: "Swipe file that gets opens + replies", type: "DOC", icon: "send", mode: "content" },
] as const satisfies readonly import("./learn").ImproveResource[];
