// `window.ch`, as exposed by src/main/preload.js. Keep the two in step.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string;
  instagram?: string | null;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  signedOut?: boolean;
  error?: string;
}

export interface RealtimeMessage {
  channel: string;
  name: string;
  data: unknown;
}

export interface NativeMenuItem {
  id?: string;
  label?: string;
  sublabel?: string;
  type?: "separator";
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  submenu?: NativeMenuItem[];
}

export interface DesktopSettings {
  notifications: boolean;
  pausedUntil: number;
  sound: "honey" | "system" | "none";
  badge: "mentions" | "off";
  keepRunning: boolean;
  theme: "system" | "light" | "dark";
  zoom: number;
  openAtLogin: boolean;
  touchId: boolean;
  bounceDock: boolean;
  touchIdAvailable: boolean;
}

export type UploadResult =
  | { ok: true; url: string; pathname: string; contentType: string; size: number }
  /** `message`: the website's sentence when `error` is "rate_limited". */
  | { ok: false; error: string; message?: string };

type Unsubscribe = () => void;
type Listen<T> = (callback: (payload: T) => void) => Unsubscribe;

/** What a creatorhive:// link asks for (src/main/links.js). */
export type AppLink = { kind: "invite"; token: string } | { kind: "sign-in"; email: string };

export interface Bridge {
  info(): Promise<{ version: string; preview: boolean; platform: string; origin: string; fullscreen: boolean }>;
  auth: {
    session(): Promise<{ user: SessionUser | null; offline?: boolean }>;
    signIn(email: string, password: string): Promise<{ ok: boolean; user?: SessionUser; error?: string }>;
    /** Whether the server offers Continue with Google. */
    googleAvailable(): Promise<boolean>;
    /** Signs in through the Mac's browser; resolves when it comes back (or is cancelled). */
    google(): Promise<{ ok: boolean; user?: SessionUser; error?: string }>;
    cancelGoogle(): void;
    signOut(): Promise<{ ok: boolean }>;
    /** Sends the password reset email (always "ok" for an address with no account, as the website does). */
    forgotPassword(email: string): Promise<{ ok: boolean }>;
    onChanged: Listen<null>;
  };
  api<T>(request: { method?: string; path: string; body?: unknown }): Promise<ApiResult<T>>;
  /** creatorhive:// links (the website's "Open your invite"): taken once each. */
  links: {
    take(): Promise<AppLink | null>;
    onArrived: Listen<null>;
  };
  /** A streamed POST (newline-delimited JSON); each line arrives in onLine. Resolves with the status when done. */
  apiStream(request: { path: string; body: unknown }, onLine: (line: string) => void): Promise<{ ok: boolean; status: number; error?: string; data?: unknown }>;
  realtime: {
    watch(name: string): void;
    unwatch(name: string): void;
    /** Channels the live connection should be able to hear (a DM started after it connected gets a fresh token). */
    ensure(names: string[]): void;
    onMessage: Listen<RealtimeMessage>;
    onState: Listen<string>;
  };
  menu: { popup(items: NativeMenuItem[]): Promise<string | null> };
  settings: { get(): Promise<DesktopSettings>; set(patch: Partial<DesktopSettings>): Promise<DesktopSettings> };
  app: {
    setViewing(id: string | null): void;
    setHeySocialAccess(value: boolean): void;
    openExternal(url: string): void;
    openSite(path: string): void;
    refreshBadge(): void;
    installUpdate(): void;
    /** The version that has downloaded and waits for a restart, if any. */
    updateStatus(): Promise<string | null>;
    checkUpdates(): void;
    onCommand: Listen<string>;
    onNavigate: Listen<string>;
    onUpdateReady: Listen<string>;
    openMain(target: string): void;
    /** A message to every window (the huddle window listens for "leave" and "toggle-mic"). */
    relay(message: { topic: string; action: string; data?: unknown }): void;
    share(url: string, text?: string): void;
    isLocked(): Promise<boolean>;
    unlock(): Promise<boolean>;
    /** The Touch ID lock's fallback: the account's password, checked by the server. */
    unlockWithPassword(password: string): Promise<{ ok: boolean; error?: "wrong" | "offline" | "no_password" | "too_many_attempts" }>;
    onLocked: Listen<boolean>;
    onPopup: Listen<import("./popups").LivePopup>;
    onRelay: Listen<{ topic: string; action: string; data?: unknown }>;
    onNavigateView: Listen<string>;
  };
  files: {
    upload(request: { route: string; name: string; type: string; bytes: ArrayBuffer; access?: "public" | "private"; clientPayload?: string }): Promise<UploadResult>;
    quickLook(url: string, name: string): Promise<{ ok: boolean }>;
    save(url: string, name: string): Promise<{ ok: boolean; canceled?: boolean }>;
    /** Several files into one folder the member picks once; video files stream to disk. */
    saveMany(items: { url: string; name: string }[], title?: string): Promise<{ ok: boolean; canceled?: boolean }>;
    addToCalendar(ics: string, name: string): Promise<{ ok: boolean }>;
    clipboardImage(): Promise<Uint8Array | null>;
    putVideo(url: string, type: string, bytes: ArrayBuffer): Promise<{ ok: boolean; status?: number; error?: string }>;
    uploadForm(request: { path: string; field: string; name: string; type: string; bytes: ArrayBuffer; fields?: Record<string, string> }): Promise<{ ok: boolean; status?: number; error?: string; data?: unknown }>;
    pickVideo(): Promise<LocalVideoFile | null>;
    videoInfo(file: File): Promise<LocalVideoFile | null>;
    putFile(request: { id: string; url: string; type: string; filePath: string }): Promise<{ ok: boolean; status?: number; error?: string }>;
    putPart(request: { id: string; url: string; filePath: string; start: number; end: number }): Promise<{ ok: boolean; status?: number; error?: string }>;
    pickFolder(title: string): Promise<string | null>;
    /** Saves `url` to <folder>/<parts…> (each part cleaned); only a folder from pickFolder. */
    saveInto(request: { folder: string; parts: string[]; url: string }): Promise<{ ok: boolean; path?: string; status?: number; error?: string }>;
    showInFolder(filePath: string): Promise<void>;
    cancelPut(id: string): void;
    onPutProgress: Listen<{ id: string; sent: number; total: number }>;
  };
  errors: {
    /** An error for Admin → Bugs; the main process dedupes, caps and sends it (lib/errors.tsx). */
    report(report: { kind: "render" | "error" | "unhandled-rejection"; message: string; stack?: string | null; componentStack?: string | null; route?: string | null }): void;
    setScreen(screen: string): void;
  };
  window: {
    popout(target: { kind: "dm" | "channel" | "thread" | "deal" | "lesson" | "settings" | "huddle"; id: string; title?: string }): void;
    onFullscreen: Listen<boolean>;
    onFocus: Listen<boolean>;
    /** Esc pressed while a frame inside the page (the booking pop-up) has focus; main window only. */
    onEscape: Listen<void>;
  };
}

declare global {
  interface Window {
    ch: Bridge;
  }
}

export const ch = window.ch;

/** A video on this Mac, picked or dropped, by path (its bytes stay on disk until the upload streams them). */
export interface LocalVideoFile { path: string; name: string; size: number }
