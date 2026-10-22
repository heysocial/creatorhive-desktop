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
  type?: "separator";
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  submenu?: NativeMenuItem[];
}

export type UploadResult =
  | { ok: true; url: string; pathname: string; contentType: string; size: number }
  | { ok: false; error: string };

type Unsubscribe = () => void;
type Listen<T> = (callback: (payload: T) => void) => Unsubscribe;

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
    onChanged: Listen<null>;
  };
  api<T>(request: { method?: string; path: string; body?: unknown }): Promise<ApiResult<T>>;
  realtime: {
    watch(name: string): void;
    unwatch(name: string): void;
    onMessage: Listen<RealtimeMessage>;
    onState: Listen<string>;
  };
  menu: { popup(items: NativeMenuItem[]): Promise<string | null> };
  app: {
    setViewing(id: string | null): void;
    setHeySocialAccess(value: boolean): void;
    openExternal(url: string): void;
    openSite(path: string): void;
    refreshBadge(): void;
    installUpdate(): void;
    onCommand: Listen<string>;
    onNavigate: Listen<string>;
    onUpdateReady: Listen<string>;
    openMain(target: string): void;
    onNavigateView: Listen<string>;
  };
  files: {
    upload(request: { route: string; name: string; type: string; bytes: ArrayBuffer }): Promise<UploadResult>;
    quickLook(url: string, name: string): Promise<{ ok: boolean }>;
    save(url: string, name: string): Promise<{ ok: boolean }>;
    addToCalendar(ics: string, name: string): Promise<{ ok: boolean }>;
  };
  window: {
    popout(target: { kind: "dm" | "channel" | "thread" | "deal"; id: string; title?: string }): void;
    onFullscreen: Listen<boolean>;
    onFocus: Listen<boolean>;
  };
}

declare global {
  interface Window {
    ch: Bridge;
  }
}

export const ch = window.ch;
