import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient, rateLimitMessage } from "./api";
import { ch, type LocalMediaFile } from "./bridge";
import { VE_LIMITS, type VeAllowance, type VeBrief, type VeChatMessage, type VeHome, type VeProject, type VeUpload, type VeUploadKind } from "./videoEditorShared";

/*
  The AI Video Editor (Learn → Improve), creatorhive-app docs/ai-video-editor.md.
  Every call goes through the main process (window.ch.api). Uploads use the
  contract's multipart flow, as post videos do (lib/postVideo.ts): POST
  /uploads, then /parts for signed R2 links, then each 16 MB part is streamed
  from disk by the main process (ch.files.putPart; the window's origin isn't
  allowed by R2's CORS), then /complete. Several files go at once.

  The files picked for the next video live here, not in the screen, so leaving
  Improve doesn't stop their uploads.
*/

export const VE_KEY = ["video-editor"] as const;

/* ---------- Server data ---------- */

/** Not an Academy member: the server answers 403 { code: "LOCKED" }. */
export const isLocked = (error: unknown) => error instanceof ApiError && error.status === 403 && (error.data?.code === "LOCKED" || error.code === "LOCKED");

/** The plain sentence the server sends with every refusal ({ ok: false, code, error }). */
export function sentenceOf(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const limited = rateLimitMessage(error);
  if (limited) return limited;
  if (error instanceof ApiError && typeof error.data?.error === "string" && /\s/.test(error.data.error)) return error.data.error;
  return fallback;
}

export function useVeHome(enabled = true) {
  return useQuery({
    queryKey: [...VE_KEY, "home"],
    enabled,
    retry: (count, error) => !isLocked(error) && !(error instanceof ApiError && [401, 404].includes(error.status)) && count < 2,
    queryFn: () => api<VeHome & { ok?: boolean }>("/api/video-editor"),
  });
}

/** A video, checked every 3 s while it's being made. */
export function useVeProject(id: string | null) {
  return useQuery({
    queryKey: [...VE_KEY, "project", id],
    enabled: Boolean(id),
    queryFn: async () => (await api<{ project: VeProject }>(`/api/video-editor/projects/${id}`)).project,
    refetchInterval: (query) => {
      const p = query.state.data as VeProject | undefined;
      return p && (p.status === "queued" || p.status === "working" || p.finalizing) ? 3_000 : false;
    },
  });
}

export function setProject(project: VeProject) {
  queryClient.setQueryData([...VE_KEY, "project", project.id], project);
  void queryClient.invalidateQueries({ queryKey: [...VE_KEY, "home"] });
}

export function useVeChat(projectId: string | null) {
  return useQuery({
    queryKey: [...VE_KEY, "chat", projectId ?? "general"],
    queryFn: () => api<{ messages: VeChatMessage[]; allowance: VeAllowance }>(`/api/video-editor/chat${projectId ? `?projectId=${projectId}` : ""}`),
  });
}

export const veApi = {
  create: (body: { brief: Partial<VeBrief>; mains: string[]; clips: string[]; music: string | null; reference: string | null }) =>
    api<{ project: VeProject }>("/api/video-editor/projects", { method: "POST", body }),
  revise: (id: string, body: { notes?: string; comments?: { t: number; text: string }[] }) =>
    api<{ project: VeProject }>(`/api/video-editor/projects/${id}/revise`, { method: "POST", body }),
  approve: (id: string) => api<{ project: VeProject }>(`/api/video-editor/projects/${id}/approve`, { method: "POST" }),
  cancel: (id: string) => api<{ project: VeProject }>(`/api/video-editor/projects/${id}/cancel`, { method: "POST" }),
  chat: (projectId: string | null, message: string) =>
    api<{ reply: VeChatMessage; project?: VeProject; allowance: VeAllowance }>("/api/video-editor/chat", { method: "POST", body: { ...(projectId ? { projectId } : {}), message } }),
};

/* ---------- Files for the next video ---------- */

export type VeFilePhase = "starting" | "uploading" | "finishing" | "offline" | "done" | "failed";

export interface VeFile {
  localId: string;
  kind: VeUploadKind;
  name: string;
  size: number;
  path: string;
  mimeType: string;
  media: LocalMediaFile["kind"];
  /** Length in seconds, read on this Mac (videos; null when it couldn't be read). */
  seconds: number | null;
  /** A small still (data: URL) for the clip strip. */
  thumb: string | null;
  uploadId: string | null;
  sent: number;
  phase: VeFilePhase;
  error: string | null;
}

/** A file that couldn't be added (too long, wrong type…), shown under its drop zone. */
export interface VeRefusal { kind: VeUploadKind; message: string }

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp3: "audio/mpeg", m4a: "audio/x-m4a", wav: "audio/wav", aac: "audio/aac",
};
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

const ACCEPTS: Record<VeUploadKind, LocalMediaFile["kind"][]> = { main: ["video"], clip: ["video", "image"], music: ["audio"], reference: ["video"] };
export const ACCEPT_ATTR: Record<VeUploadKind, string> = {
  main: "video/*,.mov,.mp4,.m4v,.webm",
  clip: "video/*,image/jpeg,image/png,image/webp,.mov,.mp4,.m4v,.webm,.jpg,.jpeg,.png,.webp",
  music: "audio/*,.mp3,.m4a,.wav,.aac",
  reference: "video/*,.mov,.mp4,.m4v,.webm",
};

const PARTS_AT_ONCE = 4;
const FILES_AT_ONCE = 2;
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const STOPPED = "The upload didn't finish. Check your connection and try again.";

interface Job {
  file: VeFile;
  partSize: number;
  partCount: number;
  done: Set<number>;
  inFlight: Map<string, number>;
  urls: Map<number, string>;
  urlFetch: Promise<void> | null;
  running: boolean;
  cancelled: boolean;
}

let jobs: Job[] = [];
let refusals: VeRefusal[] = [];
let snapshot: { files: VeFile[]; refusals: VeRefusal[] } = { files: [], refusals: [] };
const listeners = new Set<() => void>();
const emit = () => {
  snapshot = { files: jobs.map((j) => ({ ...j.file })), refusals: [...refusals] };
  listeners.forEach((l) => l());
};
const patch = (j: Job, change: Partial<VeFile>) => {
  Object.assign(j.file, change);
  emit();
};

export function useVeFiles() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => snapshot);
}

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  ch.files.onPutProgress(({ id, sent }) => {
    const j = jobs.find((x) => x.inFlight.has(id));
    if (!j) return;
    j.inFlight.set(id, sent);
    showProgress(j);
  });
  window.addEventListener("offline", () => { for (const j of jobs) for (const id of j.inFlight.keys()) ch.files.cancelPut(id); });
}

const partBytes = (j: Job, n: number) => Math.min(n * j.partSize, j.file.size) - (n - 1) * j.partSize;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const passing = (status: number | undefined) => !status || status >= 500 || status === 408 || status === 429;

function showProgress(j: Job) {
  let sent = 0;
  for (const n of j.done) sent += partBytes(j, n);
  for (const b of j.inFlight.values()) sent += b;
  patch(j, { sent: Math.min(j.file.size, sent) });
}

async function online(j: Job) {
  if (navigator.onLine) return;
  const before = j.file.phase;
  patch(j, { phase: "offline" });
  await new Promise<void>((resolve) => window.addEventListener("online", () => resolve(), { once: true }));
  if (j.file.phase === "offline") patch(j, { phase: before === "finishing" ? "finishing" : "uploading" });
}

class Stop extends Error {}

async function partUrl(j: Job, n: number): Promise<string> {
  while (!j.urls.has(n)) {
    if (!j.urlFetch) {
      const parts: number[] = [];
      for (let p = n; p <= j.partCount && parts.length < 100; p += 1) if (!j.done.has(p) && !j.urls.has(p)) parts.push(p);
      j.urlFetch = api<{ urls: { partNumber: number; url: string }[] }>(`/api/video-editor/uploads/${j.file.uploadId}/parts`, { method: "POST", body: { parts } })
        .then(({ urls }) => { for (const u of urls) j.urls.set(u.partNumber, u.url); })
        .finally(() => { j.urlFetch = null; });
    }
    await j.urlFetch;
  }
  return j.urls.get(n)!;
}

async function sendPart(j: Job, n: number) {
  const start = (n - 1) * j.partSize;
  const end = Math.min(n * j.partSize, j.file.size);
  const id = `ve:${j.file.uploadId}:${n}`;
  let refreshed = 0;
  for (let attempt = 0; ; ) {
    await online(j);
    if (j.cancelled) return;
    let url: string;
    try {
      url = await partUrl(j, n);
    } catch (error) {
      if (j.cancelled) return;
      if (!(error instanceof ApiError && passing(error.status)) || attempt >= RETRY_DELAYS.length) throw new Stop(sentenceOf(error, STOPPED));
      await sleep(RETRY_DELAYS[attempt++]);
      continue;
    }
    j.inFlight.set(id, 0);
    const result = await ch.files.putPart({ id, url, filePath: j.file.path, start, end });
    j.inFlight.delete(id);
    if (j.cancelled) return;
    if (!result.ok && result.error === "cancelled" && !navigator.onLine) { showProgress(j); continue; }
    if (result.ok) {
      j.done.add(n);
      showProgress(j);
      return;
    }
    showProgress(j);
    if (result.error === "no_file") throw new Stop("This file moved or was deleted on your Mac. Remove it and add it again.");
    if (result.status === 403 && refreshed < 3) { refreshed += 1; j.urls.delete(n); continue; }
    if (!passing(result.status) || attempt >= RETRY_DELAYS.length) throw new Stop(STOPPED);
    await sleep(RETRY_DELAYS[attempt++]);
  }
}

async function sendParts(j: Job, only?: number[]) {
  const todo = (only ?? Array.from({ length: j.partCount }, (_, i) => i + 1)).filter((n) => !j.done.has(n));
  let failure: unknown = null;
  const worker = async () => {
    while (!failure && !j.cancelled) {
      const n = todo.shift();
      if (n === undefined) return;
      try { await sendPart(j, n); } catch (error) { failure = error; }
    }
  };
  await Promise.all(Array.from({ length: PARTS_AT_ONCE }, worker));
  if (failure && !j.cancelled) throw failure;
}

async function complete(j: Job) {
  patch(j, { phase: "finishing", sent: j.file.size });
  for (let attempt = 0, resent = 0; ; ) {
    await online(j);
    if (j.cancelled) return;
    try {
      await api(`/api/video-editor/uploads/${j.file.uploadId}/complete`, { method: "POST" });
      return;
    } catch (error) {
      if (j.cancelled) return;
      if (error instanceof ApiError && error.data?.code === "INCOMPLETE" && resent < 2) {
        resent += 1;
        const missing = (error.data?.missing as number[] | undefined) ?? [];
        for (const n of missing) j.done.delete(n);
        patch(j, { phase: "uploading" });
        showProgress(j);
        await sendParts(j, missing.length ? missing : undefined);
        if (j.cancelled) return;
        patch(j, { phase: "finishing", sent: j.file.size });
        continue;
      }
      if (!(error instanceof ApiError && passing(error.status)) || attempt >= RETRY_DELAYS.length) throw new Stop(sentenceOf(error, STOPPED));
      await sleep(RETRY_DELAYS[attempt++]);
    }
  }
}

async function run(j: Job) {
  if (j.running || j.cancelled) return;
  j.running = true;
  patch(j, { phase: j.file.uploadId ? "uploading" : "starting", error: null });
  try {
    if (!j.file.uploadId) {
      const { upload } = await api<{ upload: VeUpload }>("/api/video-editor/uploads", {
        method: "POST", body: { kind: j.file.kind, fileName: j.file.name, mimeType: j.file.mimeType, sizeBytes: j.file.size },
      }).catch((error) => { throw new Stop(sentenceOf(error, "This file couldn't start uploading. Remove it and try again.")); });
      if (j.cancelled) {
        void api(`/api/video-editor/uploads/${upload.uploadId}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      j.partSize = upload.partSize;
      j.partCount = upload.partCount;
      patch(j, { uploadId: upload.uploadId, phase: "uploading" });
    }
    await sendParts(j);
    if (j.cancelled) return;
    await complete(j);
    if (j.cancelled) return;
    patch(j, { phase: "done", sent: j.file.size });
  } catch (error) {
    if (!j.cancelled) patch(j, { phase: "failed", error: error instanceof Error && error.message ? error.message : STOPPED });
  } finally {
    j.running = false;
    pump();
  }
}

/** Starts waiting files, a few at a time. */
function pump() {
  const running = jobs.filter((j) => j.running).length;
  let room = FILES_AT_ONCE - running;
  for (const j of jobs) {
    if (room <= 0) break;
    if (!j.running && !j.cancelled && j.file.phase === "starting" && !j.file.error) {
      room -= 1;
      void run(j);
    }
  }
}

/* Length and a still, read on this Mac from the picked File. */
function readVideo(file: File): Promise<{ seconds: number | null; thumb: string | null }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let seconds: number | null = null;
    let settled = false;
    const done = (thumb: string | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve({ seconds, thumb });
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      seconds = Number.isFinite(video.duration) ? video.duration : null;
      video.currentTime = Math.min(0.5, (seconds ?? 1) / 2);
    };
    video.onseeked = () => done(still(video, video.videoWidth, video.videoHeight));
    video.onerror = () => done(null); // some formats can't be read here; the server checks again
    video.src = url;
    setTimeout(() => done(null), 8000);
  });
}

function readImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve(still(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function still(source: CanvasImageSource, width: number, height: number): string | null {
  try {
    if (!width || !height) return null;
    const scale = 240 / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
const MAX_BYTES: Record<VeUploadKind, number> = { main: VE_LIMITS.mainBytes, clip: VE_LIMITS.clipBytes, music: VE_LIMITS.musicBytes, reference: VE_LIMITS.referenceBytes };
const live = (kind: VeUploadKind) => jobs.filter((j) => j.file.kind === kind && !j.cancelled);

/**
 * Files picked or dropped on a zone. Main videos picked together are added in
 * name order (Line 1, Line 2 … Line 10), as on the website. Music and the
 * reference video replace the one there.
 */
export async function addVeFiles(kind: VeUploadKind, files: File[]) {
  hook();
  refusals = refusals.filter((r) => r.kind !== kind);
  emit();
  const list = kind === "main" ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })) : [...files];
  const refuse = (message: string) => { refusals = [...refusals, { kind, message }]; emit(); };
  for (const file of kind === "music" || kind === "reference" ? list.slice(0, 1) : list) {
    const info = await ch.files.mediaInfo(file);
    const mimeType = info ? (MIME_BY_EXT[extOf(info.name)] ?? file.type) : null;
    if (!info || !mimeType || !ACCEPTS[kind].includes(info.kind)) {
      refuse(kind === "music" ? `${file.name} isn't a song we can use. Try an MP3, M4A, WAV or AAC file.`
        : kind === "clip" ? `${file.name} isn't a video or a picture we can use (pictures: JPG, PNG or WEBP).`
        : `${file.name} isn't a video we can use. Try an MP4 or MOV file.`);
      continue;
    }
    const max = kind === "clip" && info.kind === "image" ? VE_LIMITS.imageBytes : MAX_BYTES[kind];
    if (info.size > max) { refuse(`${info.name} is ${mb(info.size)}. The limit is ${mb(max)}.`); continue; }
    if (kind === "main" && live("main").length >= VE_LIMITS.maxMainTakes) { refuse(`You can add up to ${VE_LIMITS.maxMainTakes} main videos.`); break; }
    if (kind === "clip" && live("clip").length >= VE_LIMITS.maxClips) { refuse(`You can add up to ${VE_LIMITS.maxClips} extra files.`); break; }

    let seconds: number | null = null;
    let thumb: string | null = null;
    if (info.kind === "video") ({ seconds, thumb } = await readVideo(file));
    else if (info.kind === "image") thumb = await readImage(file);
    if (kind === "main" && seconds !== null) {
      const max = VE_LIMITS.maxMainSeconds;
      if (seconds > max) { refuse(`This video is ${Math.round(seconds)} seconds long. The limit is ${max / 60} minutes, so please trim it a little.`); continue; }
      const have = live("main").reduce((sum, j) => sum + (j.file.seconds ?? 0), 0);
      if (have + seconds > max) { refuse(`Your main videos would add up to ${Math.round(have + seconds)} seconds. The limit is ${max / 60} minutes in total.`); continue; }
    }
    if (kind === "reference" && seconds !== null && seconds > VE_LIMITS.maxReferenceSeconds) {
      refuse(`This video is ${Math.round(seconds)} seconds long. The video you like can be up to ${VE_LIMITS.maxReferenceSeconds / 60} minutes.`);
      continue;
    }
    if (kind === "music" || kind === "reference") for (const j of live(kind)) removeVeFile(j.file.localId);

    const job: Job = {
      file: { localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, name: info.name, size: info.size, path: info.path, mimeType, media: info.kind, seconds, thumb, uploadId: null, sent: 0, phase: "starting", error: null },
      partSize: 0, partCount: 0, done: new Set(), inFlight: new Map(), urls: new Map(), urlFetch: null, running: false, cancelled: false,
    };
    jobs = [...jobs, job];
    emit();
    pump();
  }
}

export function removeVeFile(localId: string) {
  const j = jobs.find((x) => x.file.localId === localId);
  if (!j) return;
  j.cancelled = true;
  for (const id of j.inFlight.keys()) ch.files.cancelPut(id);
  if (j.file.uploadId) void api(`/api/video-editor/uploads/${j.file.uploadId}`, { method: "DELETE" }).catch(() => undefined);
  jobs = jobs.filter((x) => x !== j);
  emit();
  pump();
}

/** Main videos are joined in the order shown: Up and Down move one. */
export function moveVeFile(localId: string, by: -1 | 1) {
  const j = jobs.find((x) => x.file.localId === localId);
  if (!j) return;
  const same = jobs.filter((x) => x.file.kind === j.file.kind);
  const i = same.indexOf(j);
  const other = same[i + by];
  if (!other) return;
  const a = jobs.indexOf(j);
  const b = jobs.indexOf(other);
  const next = [...jobs];
  [next[a], next[b]] = [next[b], next[a]];
  jobs = next;
  emit();
}

export function retryVeFile(localId: string) {
  const j = jobs.find((x) => x.file.localId === localId);
  if (!j || j.file.phase !== "failed") return;
  patch(j, { phase: j.file.uploadId ? "uploading" : "starting", error: null });
  if (j.file.uploadId) void run(j);
  else pump();
}

export function dismissVeRefusals(kind: VeUploadKind) {
  refusals = refusals.filter((r) => r.kind !== kind);
  emit();
}

/** The video was started: its uploads now belong to it, so they're let go without being deleted. */
export function releaseVeFiles() {
  jobs = [];
  refusals = [];
  emit();
}

/** Start over before making the video: stop everything and free what R2 holds. */
export function clearVeFiles() {
  for (const j of [...jobs]) removeVeFile(j.file.localId);
  refusals = [];
  emit();
}

/* ---------- The questions, kept while the member moves around the app ---------- */

export type VeQuestion = "type" | "brand" | "about" | "audience" | "captions" | "notes" | "cta";
export type VeMusicChoice = "auto" | "own" | "none";

export interface VeDraft {
  /** The question the card is on. */
  question: VeQuestion;
  brief: VeBrief;
  /** null: not chosen (their song when they added one, else no music / we pick). */
  music: VeMusicChoice | null;
}

export const EMPTY_BRIEF: VeBrief = { type: "ad", brand: "", product: "", audience: "not sure", cta: "", captionLook: "classic", length: "auto", notes: "" };

let draft: VeDraft = { question: "type", brief: { ...EMPTY_BRIEF }, music: null };
const draftListeners = new Set<() => void>();

export function useVeDraft(): [VeDraft, (change: Partial<VeDraft> | ((d: VeDraft) => Partial<VeDraft>)) => void] {
  const value = useSyncExternalStore((l) => { draftListeners.add(l); return () => draftListeners.delete(l); }, () => draft);
  return [value, setVeDraft];
}

export function setVeDraft(change: Partial<VeDraft> | ((d: VeDraft) => Partial<VeDraft>)) {
  draft = { ...draft, ...(typeof change === "function" ? change(draft) : change) };
  draftListeners.forEach((l) => l());
}

/** "Make another video": the answers that belong to one video are cleared, the look and length stay (as on the website). */
export function resetVeDraft() {
  draft = { question: "type", brief: { ...draft.brief, brand: "", product: "", cta: "", audience: "not sure", notes: "" }, music: null };
  draftListeners.forEach((l) => l());
}

/* The video set aside with "Make another video", remembered on this Mac (the website keeps it the same way). */
const DISMISSED_KEY = "ch.ve.dismissed";
export function readDismissed(): string | null {
  try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; }
}
export function writeDismissed(id: string) {
  try { localStorage.setItem(DISMISSED_KEY, id); } catch { /* storage off: the last video shows again next time */ }
}

/* ---------- Words ---------- */

export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
export const fmtLength = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
