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
/** `course` is The Weekend Starter's step 1 ("Go through the video course"), from Nov 10. */
export type StarterStepId = "course" | "first_video" | "three_videos" | "applications" | "brand_reply" | "paid_deal";

/** The course behind The Weekend Starter's step 1. */
export interface StarterCourseProgress {
  slug: string;
  title: string;
  lessons: number;
  completed: number;
  /** Total minutes of the published lessons; null when they have no durations. */
  minutes: number | null;
  /** Ticked by hand ("Mark as done"). */
  markedDone: boolean;
}

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
  /** Step `course` only. */
  course?: StarterCourseProgress | null;
  /** Step `three_videos` on The Weekend Starter, until the course is done: "Finish the course first". */
  locked?: string | null;
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

/** S3's single-PUT ceiling is 5 GiB, per clip. */
export const SUBMISSION_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const SUBMISSION_SLOTS = [1, 2, 3] as const;
/** Each video holds up to this many clips (Simon, Nov 12 2026; creatorhive-app docs/multi-clip.md). */
export const CLIPS_PER_VIDEO_MAX = 20;

export interface SubmissionVideo {
  id: string;
  /** Video 1, 2 or 3. */
  slot: number;
  /** Order within its video (1, 2, 3…; 0 = a video sent before clips existed). Older servers leave it out. */
  position?: number;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  previewUrl: string;
  /** A still from the video (Mux, signed), once ready; older servers leave it out. */
  thumbnailUrl?: string | null;
}

export interface VideoSubmissionState {
  status: "draft" | "submitted";
  submittedAt: string | null;
  /** Finished clips only, by slot then position: several per slot. */
  videos: SubmissionVideo[];
  maxBytes: number;
  /** 20. Older servers leave it out (one file per video). */
  maxClipsPerVideo?: number;
  /** She can add or remove clips now: before Submit, and after it until editing starts. */
  canEditClips?: boolean;
  /** The personal video editor (lib/videoEdits.ts); older servers leave it out. */
  editing?: import("./videoEdits").StudentEditState;
}

/** POST /api/improve/videos/uploads → PUT the bytes (whole, or in parts), then POST …/complete. */
export interface SubmissionUploadTicket {
  videoId: string;
  /** Single PUT of the whole file. Empty when `multipart` is set. */
  uploadUrl: string;
  /** Send this as the PUT's Content-Type. */
  contentType: string;
  /** Part n (1-based) is bytes [(n-1)·partSize, n·partSize) of the file; URLs from POST …/uploads/{videoId}/parts. Null = single PUT. */
  multipart?: { partSize: number; partCount: number } | null;
}

/** The finished clips of one video, in order. */
export function clipsOf(state: VideoSubmissionState | null | undefined, slot: number): SubmissionVideo[] {
  return (state?.videos ?? []).filter((v) => v.slot === slot).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Whether she may add or remove clips now (older servers: before Submit, or while Replace was open). */
export function canEditClipsNow(state: VideoSubmissionState | null | undefined): boolean {
  if (!state) return false;
  if (typeof state.canEditClips === "boolean") return state.canEditClips;
  return state.status === "draft" || Boolean(state.editing?.canReplace);
}

export const clipsLabel = (n: number) => `${n} ${n === 1 ? "clip" : "clips"}`;

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

/** The Weekend Starter's step 1: "Mark as done" (or undo). */
export async function markCourseDone(done: boolean) {
  await api("/api/improve/starter/course", { method: "POST", body: { done } });
  await queryClient.invalidateQueries({ queryKey: ["improve"], exact: true });
}

export function setSubmissionState(state: VideoSubmissionState) {
  setSubmission(state);
}

export async function markFirstVideo(done: boolean) {
  await api("/api/improve/starter/first-video", { method: "POST", body: { done } });
  await queryClient.invalidateQueries({ queryKey: ["improve"], exact: true });
}

/*
  ---------- Clip uploads (creatorhive-app docs/multi-clip.md) ----------
  Kept outside React, so they carry on while she uses the rest of the app.
  Each clip: POST …/uploads (mode "add", multipart), one after another so the
  clips keep the order she picked them in; then its bytes stream from disk
  (main process, files:putPart) in 16 MB parts, three at a time, two clips at
  a time. A part that fails is sent again after 1 s, 2 s, 4 s … (30 s at most);
  while the Mac is offline everything waits for the connection; an expired
  part URL is asked for again. Then POST …/complete; INCOMPLETE sends the
  parts again once.
*/

export interface VideoMeta { durationSeconds: number | null; width: number | null; height: number | null }

/** A clip she picked or dropped: where it is on disk, its length and size, and a still for its tile. */
export interface ClipFile { info: LocalVideoFile; meta: VideoMeta; still: string | null }

export type ClipUploadStatus = "queued" | "uploading" | "offline" | "finishing" | "failed";

export interface ClipUpload {
  key: string;
  slot: number;
  name: string;
  size: number;
  sent: number;
  status: ClipUploadStatus;
  error: string | null;
  /** A still read from the file on this Mac (data: URL), or null. */
  still: string | null;
  durationSeconds: number | null;
}

interface Job {
  key: string;
  slot: number;
  file: LocalVideoFile;
  meta: VideoMeta;
  ticket: SubmissionUploadTicket | null;
  /** Parts R2 said yes to (multipart). */
  done: Set<number>;
  /** Bytes of the parts in `done`. */
  doneBytes: number;
  /** Puts on their way: id → bytes sent so far. */
  inFlight: Map<string, number>;
  urls: Map<number, string>;
  urlFetch: Promise<void> | null;
  running: boolean;
  cancelled: boolean;
  /** The upload can't be resumed (its link expired, or the server dropped it): Try again starts it over. */
  restart: boolean;
}

class UploadStop extends Error {
  constructor(message: string, readonly restart = false) { super(message); }
}

const MAX_TRIES = 8;
const FILES_AT_ONCE = 2;
const PARTS_AT_ONCE = 3;
const STOPPED = "The upload stopped. Check your connection, then tap to try again.";

let uploads: ClipUpload[] = [];
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const patch = (key: string, change: Partial<ClipUpload>) => {
  uploads = uploads.map((u) => (u.key === key ? { ...u, ...change } : u));
  emit();
};
const drop = (key: string) => {
  jobs.delete(key);
  uploads = uploads.filter((u) => u.key !== key);
  emit();
};
const statusOf = (key: string) => uploads.find((u) => u.key === key)?.status;

export function useClipUploads(): ClipUpload[] {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => uploads,
  );
}

let progressHooked = false;
function hookProgress() {
  if (progressHooked) return;
  progressHooked = true;
  ch.files.onPutProgress(({ id, sent }) => {
    const job = jobs.get(id.slice(0, id.lastIndexOf(":")));
    if (!job || job.cancelled || !job.inFlight.has(id)) return;
    job.inFlight.set(id, sent);
    showProgress(job);
  });
}

function showProgress(job: Job) {
  let sent = job.doneBytes;
  for (const bytes of job.inFlight.values()) sent += bytes;
  patch(job.key, { sent: Math.min(job.file.size, sent) });
}

function messageOf(error: unknown, fallback: string) {
  if (error instanceof ApiError && typeof error.data?.error === "string") return error.data.error;
  return fallback;
}

/** No answer (offline), or the server or storage had a moment: worth sending again. */
const passing = (status: number | undefined) => !status || status >= 500 || status === 408 || status === 429;
const apiPassing = (error: unknown) => error instanceof ApiError && passing(error.status) && error.data?.code !== "UNAVAILABLE";
const codeOf = (error: unknown) => (error instanceof ApiError && typeof error.data?.code === "string" ? error.data.code : null);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) => sleep(Math.min(30_000, 1000 * 2 ** attempt));

/** While the Mac is offline: the tile says "Waiting for internet", and everything waits for the connection. */
async function online(job: Job) {
  if (navigator.onLine) return;
  patch(job.key, { status: "offline" });
  await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
  if (!job.cancelled && statusOf(job.key) === "offline") patch(job.key, { status: "uploading" });
}

/** Clips a video has now: finished ones plus the ones on their way (read live, not from a render). */
export function clipCount(slot: number): number {
  const state = queryClient.getQueryData<{ state: VideoSubmissionState | null }>(SUBMISSION_KEY)?.state;
  return clipsOf(state, slot).length + uploads.filter((u) => u.slot === slot).length;
}

/** Adds clips to a video, in the order given. The caller keeps to 20 per video. */
export function addClips(slot: number, files: ClipFile[]) {
  hookProgress();
  for (const { info, meta, still } of files) {
    const key = crypto.randomUUID();
    jobs.set(key, {
      key, slot, file: info, meta, ticket: null, done: new Set(), doneBytes: 0, inFlight: new Map(), urls: new Map(),
      urlFetch: null, running: false, cancelled: false, restart: false,
    });
    uploads = [...uploads, { key, slot, name: info.name, size: info.size, sent: 0, status: "queued", error: null, still, durationSeconds: meta.durationSeconds }];
  }
  emit();
  void startTickets();
}

/* One POST at a time, so each clip's position follows the order she picked. */
let ticketing = false;
async function startTickets() {
  if (ticketing) return;
  ticketing = true;
  try {
    for (;;) {
      const next = uploads.find((u) => u.status === "queued" && !jobs.get(u.key)?.ticket);
      const job = next ? jobs.get(next.key) : undefined;
      if (!job) break;
      await ticketFor(job);
    }
  } finally {
    ticketing = false;
  }
}

async function ticketFor(job: Job) {
  for (let attempt = 0; ; attempt += 1) {
    await online(job);
    if (job.cancelled) return;
    try {
      const { ticket } = await api<{ ticket: SubmissionUploadTicket }>("/api/improve/videos/uploads", {
        method: "POST",
        body: {
          slot: job.slot, fileName: job.file.name, mimeType: "", sizeBytes: job.file.size,
          ...job.meta, mode: "add", multipart: true,
        },
      });
      if (job.cancelled) {
        void api(`/api/improve/videos/${ticket.videoId}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      job.ticket = ticket;
      kick();
      return;
    } catch (error) {
      if (job.cancelled) return;
      if (apiPassing(error) && attempt < MAX_TRIES) {
        await backoff(attempt);
        continue;
      }
      patch(job.key, { status: "failed", error: messageOf(error, STOPPED) });
      return;
    }
  }
}

/* Clips with a ticket go up two at a time, in order. */
let running = 0;
function kick() {
  for (const u of uploads) {
    if (running >= FILES_AT_ONCE) return;
    const job = jobs.get(u.key);
    if (!job || job.running || job.cancelled || !job.ticket || u.status === "failed") continue;
    job.running = true;
    running += 1;
    if (u.status === "queued") patch(job.key, { status: "uploading" });
    void transfer(job).finally(() => {
      job.running = false;
      running -= 1;
      kick();
    });
  }
}

async function transfer(job: Job) {
  try {
    if (job.ticket?.multipart) await sendParts(job);
    else await sendWhole(job);
    if (job.cancelled) return;
    await complete(job);
  } catch (error) {
    if (job.cancelled) return;
    job.restart = error instanceof UploadStop && error.restart;
    patch(job.key, { status: "failed", error: error instanceof Error && error.message ? error.message : STOPPED });
  }
}

function putFailure(result: { ok: boolean; status?: number; error?: string }) {
  if (result.error === "no_file") return new UploadStop("This clip isn't on this Mac any more. Remove it and add it again.");
  if (result.error === "bad_url" || result.error === "bad_range") return new UploadStop("The upload didn't work. Tap to try again.", true);
  if (!passing(result.status)) return new UploadStop("The upload didn't work. Tap to try again.", true);
  return null;
}

async function sendWhole(job: Job) {
  const ticket = job.ticket!;
  const id = `${job.key}:0`;
  for (let attempt = 0; ; attempt += 1) {
    await online(job);
    if (job.cancelled) return;
    job.inFlight.set(id, 0);
    const result = await ch.files.putFile({ id, url: ticket.uploadUrl, type: ticket.contentType, filePath: job.file.path });
    job.inFlight.delete(id);
    if (job.cancelled) return;
    if (result.ok) {
      job.doneBytes = job.file.size;
      showProgress(job);
      return;
    }
    if (result.status === 403) throw new UploadStop("The upload link expired. Tap to try again.", true);
    const stop = putFailure(result);
    if (stop) throw stop;
    if (attempt >= MAX_TRIES) throw new UploadStop(STOPPED);
    showProgress(job);
    await backoff(attempt);
  }
}

async function sendParts(job: Job) {
  const { partCount } = job.ticket!.multipart!;
  const todo: number[] = [];
  for (let n = 1; n <= partCount; n += 1) if (!job.done.has(n)) todo.push(n);
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && !job.cancelled) {
      const n = todo.shift();
      if (n === undefined) return;
      try {
        await sendPart(job, n);
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: PARTS_AT_ONCE }, worker));
  if (failure && !job.cancelled) throw failure;
}

/** URLs for part n and the next ones still to send (up to 100 per ask); one ask at a time. */
async function partUrl(job: Job, n: number): Promise<string> {
  const { partCount } = job.ticket!.multipart!;
  while (!job.urls.has(n)) {
    if (!job.urlFetch) {
      const parts: number[] = [];
      for (let p = n; p <= partCount && parts.length < 100; p += 1) if (!job.done.has(p) && !job.urls.has(p)) parts.push(p);
      job.urlFetch = api<{ urls: Array<{ partNumber: number; url: string }> }>(`/api/improve/videos/uploads/${job.ticket!.videoId}/parts`, { method: "POST", body: { parts } })
        .then(({ urls }) => { for (const u of urls) job.urls.set(u.partNumber, u.url); })
        .finally(() => { job.urlFetch = null; });
    }
    await job.urlFetch;
  }
  return job.urls.get(n)!;
}

async function sendPart(job: Job, n: number) {
  const { partSize } = job.ticket!.multipart!;
  const start = (n - 1) * partSize;
  const end = Math.min(n * partSize, job.file.size);
  const id = `${job.key}:${n}`;
  let refreshed = 0;
  for (let attempt = 0; ; ) {
    await online(job);
    if (job.cancelled) return;
    let url: string;
    try {
      url = await partUrl(job, n);
    } catch (error) {
      if (job.cancelled) return;
      if (codeOf(error) === "NOT_FOUND" || (error instanceof ApiError && error.status === 404)) throw new UploadStop(messageOf(error, STOPPED), true);
      if (!apiPassing(error)) throw new UploadStop(messageOf(error, STOPPED));
      if (++attempt > MAX_TRIES) throw new UploadStop(STOPPED);
      await backoff(attempt - 1);
      continue;
    }
    job.inFlight.set(id, 0);
    const result = await ch.files.putPart({ id, url, filePath: job.file.path, start, end });
    job.inFlight.delete(id);
    if (job.cancelled) return;
    if (result.ok) {
      job.done.add(n);
      job.doneBytes += end - start;
      showProgress(job);
      return;
    }
    showProgress(job);
    // The part's link expired (6 h): ask for a new one.
    if (result.status === 403 && refreshed < 3) {
      refreshed += 1;
      job.urls.delete(n);
      continue;
    }
    const stop = putFailure(result);
    if (stop) throw stop;
    if (++attempt > MAX_TRIES) throw new UploadStop(STOPPED);
    await backoff(attempt - 1);
  }
}

async function complete(job: Job) {
  patch(job.key, { status: "finishing", sent: job.file.size });
  let resent = false;
  for (let attempt = 0; ; ) {
    await online(job);
    if (job.cancelled) return;
    try {
      const { submission } = await api<{ submission: VideoSubmissionState }>(`/api/improve/videos/uploads/${job.ticket!.videoId}/complete`, { method: "POST" });
      if (job.cancelled) return;
      setSubmission(submission);
      drop(job.key);
      return;
    } catch (error) {
      if (job.cancelled) return;
      if (codeOf(error) === "INCOMPLETE") {
        // Some part never arrived: send them all again, once.
        if (resent || !job.ticket?.multipart) throw new UploadStop(messageOf(error, STOPPED), true);
        resent = true;
        job.done.clear();
        job.doneBytes = 0;
        patch(job.key, { status: "uploading", sent: 0 });
        await sendParts(job);
        if (job.cancelled) return;
        patch(job.key, { status: "finishing", sent: job.file.size });
        continue;
      }
      if (codeOf(error) === "NOT_FOUND") throw new UploadStop(messageOf(error, STOPPED), true);
      if (!apiPassing(error)) throw new UploadStop(messageOf(error, STOPPED));
      if (++attempt > MAX_TRIES) throw new UploadStop(STOPPED);
      await backoff(attempt - 1);
    }
  }
}

/** "Tap to try again": only the parts that didn't arrive are sent (or the clip starts over when it can't resume). */
export function retryClip(key: string) {
  const job = jobs.get(key);
  if (!job || statusOf(key) !== "failed") return;
  if (job.restart && job.ticket) {
    void api(`/api/improve/videos/${job.ticket.videoId}`, { method: "DELETE" }).catch(() => undefined);
    job.ticket = null;
    job.done.clear();
    job.doneBytes = 0;
    job.urls.clear();
  }
  job.restart = false;
  patch(key, { status: job.ticket ? "uploading" : "queued", error: null, sent: job.doneBytes });
  if (job.ticket) kick();
  else void startTickets();
}

/** The × on an uploading clip: stops it and tells the server. */
export function cancelClip(key: string) {
  const job = jobs.get(key);
  if (!job) return;
  job.cancelled = true;
  for (const id of job.inFlight.keys()) ch.files.cancelPut(id);
  drop(key);
  if (job.ticket) {
    void api<{ submission: VideoSubmissionState }>(`/api/improve/videos/${job.ticket.videoId}`, { method: "DELETE" })
      .then(({ submission }) => setSubmission(submission)).catch(() => undefined);
  }
}

/** The × on a finished clip. Null when it worked, else what to say (e.g. LAST_CLIP after Submit). */
export async function removeClip(videoId: string): Promise<string | null> {
  try {
    const { submission } = await api<{ submission: VideoSubmissionState }>(`/api/improve/videos/${videoId}`, { method: "DELETE" });
    setSubmission(submission);
    return null;
  } catch (error) {
    return messageOf(error, "Couldn't remove that clip. Try again.");
  }
}

/** Length and size from the file itself, as the website reads them: best effort, 4 s at most. */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return readClip(file, false).then((clip) => clip.meta);
}

/** Length, size and (when `withStill`) a small still for the clip's tile, read from the file: best effort, 4 s at most. */
export function readClip(file: File, withStill = true): Promise<{ meta: VideoMeta; still: string | null }> {
  return new Promise((resolve) => {
    let meta: VideoMeta = { durationSeconds: null, width: null, height: null };
    let url: string;
    try { url = URL.createObjectURL(file); } catch { resolve({ meta, still: null }); return; }
    const video = document.createElement("video");
    let settled = false;
    const finish = (still: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve({ meta, still });
    };
    const timer = setTimeout(() => finish(null), 4000);
    video.preload = "auto";
    video.muted = true;
    video.onloadedmetadata = () => {
      meta = {
        durationSeconds: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      };
      if (!withStill || !video.videoWidth) { finish(null); return; }
      video.currentTime = Math.min(0.5, (meta.durationSeconds ?? 1) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const scale = 320 / Math.max(video.videoWidth, video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** `brief`: "Notes for Valentin" (optional, up to 2000 characters). */
export async function submitForEditing(brief = ""): Promise<string | null> {
  try {
    const note = brief.trim().slice(0, 2000);
    const { submission } = await api<{ submission: VideoSubmissionState }>("/api/improve/videos/submit", { method: "POST", body: note ? { brief: note } : {} });
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
