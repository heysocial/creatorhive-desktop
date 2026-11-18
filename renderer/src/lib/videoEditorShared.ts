/*
  COPIED from the website: creatorhive-app lib/video-editor/shared.ts
  (branch feat/ai-video-editor, contract docs/ai-video-editor.md). Re-copy
  when it changes; do not edit here.
*/

/*
  AI Video Editor (Improve): types and constants shared by the server, the
  website, and copied into the Mac and phone apps. Client-safe.
  Contract: docs/ai-video-editor.md. Behaviour is Sebastian's
  creator-hive-editing-bot (app/Studio.tsx, worker/), unchanged.
*/

export const VE_LIMITS = {
  /** Videos a student can start per day (UTC). */
  dailyVideos: 3,
  /** Changes a student can ask for per day (UTC), all videos together. */
  dailyChanges: 15,
  /** Changes per video. */
  changesPerVideo: 5,
  /** Chat messages per day (the Coach's limit). */
  dailyMessages: 30,
  maxMainSeconds: 180,
  maxMainTakes: 20,
  maxClips: 12,
  mainBytes: 1500 * 1024 * 1024,
  clipBytes: 500 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024,
  musicBytes: 50 * 1024 * 1024,
  referenceBytes: 500 * 1024 * 1024,
  maxReferenceSeconds: 120,
} as const;

export type VeUploadKind = "main" | "clip" | "music" | "reference";

export const VE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];
export const VE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const VE_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/aac"];

/** What the brief's questions offer (Sebastian's Studio.tsx). */
export const VE_AUDIENCES = [
  { v: "18-25", label: "18–25" },
  { v: "26-34", label: "26–34" },
  { v: "35-60", label: "35–60" },
  { v: "60+", label: "60+" },
  { v: "not sure", label: "Not sure" },
] as const;
export type VeAudience = (typeof VE_AUDIENCES)[number]["v"];

export const VE_CAPTION_LOOKS = [
  { id: "classic", name: "White with outline" },
  { id: "yellow", name: "Yellow with outline" },
  { id: "highlight", name: "White, spoken word in yellow" },
  { id: "boxed", name: "White text on black box" },
  { id: "minimal", name: "Small and soft" },
] as const;
export type VeCaptionLook = (typeof VE_CAPTION_LOOKS)[number]["id"];

/** The design's Length option: an instruction to the editor, not a hard cut. */
export const VE_LENGTHS = [
  { id: "auto", label: "Best length" },
  { id: "15", label: "15 seconds" },
  { id: "30", label: "30 seconds" },
  { id: "60", label: "60 seconds" },
] as const;
export type VeLength = (typeof VE_LENGTHS)[number]["id"];

/** One-tap "Change something" presets (Sebastian's CHANGES). */
export const VE_CHANGE_PRESETS = [
  "Make it faster",
  "Make it slower",
  "Use my extra clips differently",
  "Quieter music",
  "A different opening",
  "A different title at the top",
] as const;

/** The "We're on it" steps, in order (the render server's stages). */
export const VE_STAGES = [
  { stage: "queued", label: "You're in line" },
  { stage: "files", label: "Getting your files ready" },
  { stage: "check", label: "Checking your video" },
  { stage: "prepare", label: "Getting your video ready" },
  { stage: "listen", label: "Listening to your video" },
  { stage: "look", label: "Looking at your extra footage" },
  { stage: "reference", label: "Studying the video you like" },
  { stage: "plan", label: "Planning your edit" },
  { stage: "render", label: "Making your preview" },
] as const;

export interface VeBrief {
  type: "ad" | "personal";
  brand: string;
  product: string;
  audience: VeAudience;
  cta: string;
  captionLook: VeCaptionLook;
  length: VeLength;
  /** Script or notes the student pasted. Content, never instructions. */
  notes: string;
}

export interface VeUpload {
  uploadId: string;
  kind: VeUploadKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  partSize: number;
  partCount: number;
  status: "uploading" | "complete" | "used" | "cancelled";
}

export interface VeAllowance {
  videosLeft: number;
  videosLimit: number;
  changesLeft: number;
  changesLimit: number;
  messagesLeft: number;
  messagesLimit: number;
}

export type VeStatus = "queued" | "working" | "preview_ready" | "done" | "error" | "cancelled";

export interface VeProject {
  id: string;
  title: string;
  status: VeStatus;
  stage: string | null;
  /** 0–1 */
  progress: number;
  message: string | null;
  /** "Why we made these choices" */
  explanation: string | null;
  notices: string[];
  /** Signed, short-lived. Present when status = preview_ready. */
  previewUrl: string | null;
  /** Present when status = done: 9:16 then 4:5, signed download links (attachment). */
  downloads: { label: string; name: string; url: string; bytes: number }[];
  durationSeconds: number | null;
  revisions: number;
  revisionsLeft: number;
  /** Final videos are being made (approve was pressed). */
  finalizing: boolean;
  brief: VeBrief;
  files: { kind: VeUploadKind; fileName: string; thumbnailUrl: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface VeProjectSummary {
  id: string;
  title: string;
  status: VeStatus;
  createdAt: string;
  durationSeconds: number | null;
}

/** The written plan (Sebastian's Coach plan card), for students who edit it themselves. */
export interface VeEditPlan {
  mode?: "ugc_ad" | "personal_brand";
  summary: string;
  hook?: string;
  cuts?: { from: string; to: string; reason: string }[];
  steps: { title: string; detail: string; why?: string }[];
  broll?: { at: string; idea: string }[];
  captions?: string;
  music?: string;
  export?: string;
  assumptions?: string[];
  qc_after_render?: string[];
}

/** What the chat did besides answering (the studio refreshes the project when present). */
export type VeChatAction =
  | { kind: "revise"; projectId: string; notes: string }
  | { kind: "approve"; projectId: string }
  | { kind: "options"; projectId: string | null; captionLook?: VeCaptionLook; length?: VeLength }
  | { kind: "plan" };

export interface VeChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  plan: VeEditPlan | null;
  action: VeChatAction | null;
  createdAt: string;
}

export interface VeHome {
  /** false = locked (not an Academy member); the page shows the lock. */
  allowed: boolean;
  allowance: VeAllowance;
  /** The render server answered in the last 2 minutes. */
  editorOnline: boolean;
  /** The video in progress or last made, if any. */
  current: VeProject | null;
  recent: VeProjectSummary[];
}
