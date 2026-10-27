import { useQuery } from "@tanstack/react-query";
import { api, queryClient } from "./api";
import { ch, type UploadResult } from "./bridge";

/*
  Live chat with CreatorHive Support, as the website and iPhone have it
  (creatorhive-app docs/support-chat.md is the contract). Students write to
  "CreatorHive Support" and never see who answered; owner and team answer from
  Admin → Support. The server decides everything — online or away, the
  automatic reply, who may read a ticket — the app only shows it.
*/

export type SupportSender = "student" | "support" | "auto";
export type TicketStatus = "open" | "waiting" | "closed";

export interface SupportAttachment {
  url: string;
  kind: "image";
  name: string;
  size: number;
  mimeType: string;
}

export interface SupportMessage {
  id: string;
  sender: SupportSender;
  body: string;
  attachments: SupportAttachment[];
  createdAt: string;
  clientMutationId: string | null;
  /** Admin only: which teammate answered. Never sent to a student. */
  authorName?: string | null;
}

export interface SupportStatus {
  online: boolean;
  label: string;
  hoursLabel: string;
}

export interface SupportState {
  helpButtonHidden: boolean;
  status: SupportStatus;
  ticket: { id: string; number: number; status: TicketStatus } | null;
  messages: SupportMessage[];
  unread: number;
}

/* The words, exactly as the website says them. */
export const SUPPORT_NAME = "CreatorHive Support";
export const SUPPORT_GREETING = "Hi there! 👋 How can we help you today?";
export const SUPPORT_TOPICS = ["I can't sign in", "Question about my Hub", "Billing or payment", "Report a bug", "Something else"] as const;
export const HIDDEN_TOAST = "Help button hidden. Bring it back anytime in Settings → Help.";

export const SUPPORT_KEY = ["support"] as const;
export const ADMIN_SUPPORT_KEY = ["admin", "support"] as const;

/** The student's chat: their current ticket, the online/away state, and whether the button is hidden. */
export function useSupport(enabled = true, { open = false }: { open?: boolean } = {}) {
  return useQuery({
    queryKey: SUPPORT_KEY,
    enabled,
    staleTime: 15_000,
    // Realtime brings replies straight away; this is the fallback while the chat is open, and for the unread dot.
    refetchInterval: open ? 15_000 : 5 * 60_000,
    queryFn: () => api<SupportState & { ok: true }>("/api/support"),
  });
}

/** The header's line under "CreatorHive Support". */
export function statusLine(status: SupportStatus | undefined): string {
  if (!status) return "";
  return status.label || (status.online ? "Online · usually replies in a few minutes" : `Away · back ${status.hoursLabel}`);
}

export async function sendSupportMessage(input: { body: string; attachments?: SupportAttachment[]; topic?: string; clientMutationId: string }) {
  const result = await api<{ ok: true; message: SupportMessage; autoReply: SupportMessage | null; ticket: SupportState["ticket"] }>(
    "/api/support/messages",
    { method: "POST", body: { ...input, attachments: input.attachments ?? [], platform: "mac" } },
  );
  return result;
}

export function markSupportRead() {
  return api("/api/support/read", { method: "POST" }).catch(() => {});
}

/** Hidden or shown on every device: the setting is the member's, kept by the server. */
export async function setHelpButtonHidden(hidden: boolean) {
  queryClient.setQueryData<SupportState & { ok: true }>(SUPPORT_KEY, (old) => (old ? { ...old, helpButtonHidden: hidden } : old));
  try {
    await api("/api/support/preferences", { method: "PATCH", body: { helpButtonHidden: hidden } });
  } finally {
    void queryClient.invalidateQueries({ queryKey: SUPPORT_KEY });
    // The Settings window and the main window each keep their own cache.
    ch.app.relay({ topic: "support", action: "changed" });
  }
}

/** A picture or screenshot for a support message, through the website's own upload route. */
export async function uploadSupportImage(file: File): Promise<SupportAttachment | { failedReason?: string }> {
  const result: UploadResult = await ch.files.upload({
    route: "/api/upload",
    name: `support-images/${Date.now()}-${file.name || "screenshot.png"}`,
    type: file.type || "image/png",
    bytes: await file.arrayBuffer(),
  });
  if (!result.ok) return { failedReason: result.error === "rate_limited" ? result.message : undefined };
  return { url: result.url, kind: "image", name: file.name || "screenshot.png", size: file.size, mimeType: result.contentType || file.type || "image/png" };
}

export const isSupportImage = (file: File) => /^image\/(png|jpeg|webp|gif|heic)$/.test(file.type);

/* ---------- Admin → Support ---------- */

export type TicketFilter = TicketStatus | "all";

export interface TicketRow {
  id: string;
  number: number;
  status: TicketStatus;
  student: { id: string; name: string; avatarUrl: string | null };
  preview: string;
  lastMessageAt: string;
  lastMessageFrom: SupportSender | null;
  unread: boolean;
  platform: string | null;
}

export interface TicketDetail {
  ticket: { id: string; number: number; status: TicketStatus; createdAt: string; platform: string | null };
  messages: SupportMessage[];
  student: {
    id: string;
    name: string;
    avatarUrl: string | null;
    email: string;
    tier: string;
    memberSince: string | null;
    hubDeals: number;
    hubPaidUsd: number;
    lastPlatform: string | null;
    pastTickets: Array<{ id: string; number: number; status: TicketStatus; createdAt: string; preview: string }>;
  };
}

export interface SupportSettings {
  timezone: string;
  days: number[];
  start: string;
  end: string;
  awayNow: boolean;
  online: boolean;
  hoursLabel: string;
}

export function useTickets(filter: TicketFilter) {
  return useQuery({
    queryKey: [...ADMIN_SUPPORT_KEY, "tickets", filter],
    refetchInterval: 60_000,
    queryFn: () => api<{ counts: Record<TicketStatus, number>; tickets: TicketRow[] }>(`/api/admin/support/tickets?status=${filter}`),
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: [...ADMIN_SUPPORT_KEY, "ticket", id],
    enabled: Boolean(id),
    queryFn: () => api<TicketDetail>(`/api/admin/support/tickets/${encodeURIComponent(id ?? "")}`),
  });
}

/** Open tickets with a student message no teammate has read: the badge on Admin → Support. */
export function useSupportUnread(enabled: boolean) {
  return useQuery({
    queryKey: [...ADMIN_SUPPORT_KEY, "unread"],
    enabled,
    refetchInterval: 2 * 60_000,
    queryFn: async () => (await api<{ count: number }>("/api/admin/support/unread")).count,
  });
}

export function useSupportSettings() {
  return useQuery({
    queryKey: [...ADMIN_SUPPORT_KEY, "settings"],
    queryFn: () => api<SupportSettings>("/api/admin/support/settings"),
  });
}

const refreshAdmin = () => void queryClient.invalidateQueries({ queryKey: ADMIN_SUPPORT_KEY });

export async function replyToTicket(id: string, input: { body: string; attachments?: SupportAttachment[]; clientMutationId: string }) {
  const result = await api<{ message: SupportMessage }>(`/api/admin/support/tickets/${encodeURIComponent(id)}/messages`, { method: "POST", body: { ...input, attachments: input.attachments ?? [] } });
  refreshAdmin();
  return result.message;
}

export async function setTicketStatus(id: string, status: TicketStatus) {
  await api(`/api/admin/support/tickets/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
  refreshAdmin();
}

export function markTicketRead(id: string) {
  return api(`/api/admin/support/tickets/${encodeURIComponent(id)}/read`, { method: "POST" })
    .then(() => queryClient.invalidateQueries({ queryKey: [...ADMIN_SUPPORT_KEY, "unread"] }))
    .catch(() => {});
}

export async function saveSupportSettings(patch: Partial<Pick<SupportSettings, "timezone" | "days" | "start" | "end" | "awayNow">>) {
  const result = await api<SupportSettings>("/api/admin/support/settings", { method: "PATCH", body: patch });
  queryClient.setQueryData([...ADMIN_SUPPORT_KEY, "settings"], result);
  return result;
}

export const STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", waiting: "Waiting", closed: "Closed" };
export const PLATFORM_LABEL: Record<string, string> = { web: "Website", ios: "iPhone", mac: "Mac" };

export function newMutationId(): string {
  return crypto.randomUUID();
}
