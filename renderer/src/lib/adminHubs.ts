import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "./api";
import type { MemberBadge } from "../views/people/LeaderboardParts";

/*
  Admin → Hubs, as the website's /admin/hubs has it (lib/admin/hubs-shared.ts,
  lib/admin/hubs.ts). The website draws that page on the server, straight from
  the database, so the Mac reads the same figures from JSON routes:

    GET /api/admin/hubs?range=month|last_month|90d|all   → { ok, summary: HubsSummary }
    GET /api/admin/hubs/<hubId>/deals|dashboard|cash      → /api/hub/deals|dashboard|cash, for that Hub

  Owner and Hubs viewers only (canSeeAdminHubs); anyone else gets a 404. Until
  the website has them, a 404 for someone Admin lets into Hubs means "not
  live yet", and the page says so (see `missing`).
*/

export const HUBS_API = "/api/admin/hubs";

export type HubsRange = "month" | "last_month" | "90d" | "all";
export const HUBS_RANGES: HubsRange[] = ["month", "last_month", "90d", "all"];
export const HUBS_RANGE_LABELS: Record<HubsRange, string> = { month: "This month", last_month: "Last month", "90d": "90 days", all: "All time" };

export interface HubsPayment { source: "Whop" | "Fanbasis"; product: string; paidAt: string; amountUsd: number; email?: string }

export interface HubsMember { id: string; name: string; avatarUrl: string | null; badge: MemberBadge; email?: string; payments?: HubsPayment[]; paymentEmails?: string[] }

export interface HubsRow {
  hubId: string;
  members: HubsMember[];
  collected: number;
  collectedAll: number;
  contracted: number;
  potential: number;
  closedCount: number;
  closedUsd: number;
  pipelineCount: number;
  lastActivityAt: string | null;
}

export type PaymentSourceStatus = "ok" | "not_connected" | "error";

export interface HubsSummary {
  range: HubsRange;
  generatedAt: string;
  rows: HubsRow[];
  empty: HubsMember[];
  studentCount: number;
  previousCollected: number | null;
  payments: { whop: PaymentSourceStatus; fanbasis: PaymentSourceStatus };
  firstPayday: { averageMonths: number; count: number } | null;
  earningBasis: { monthlyByHub: number[]; from: string; to: string };
}

/** A 404 from a route Admin says this person may use: the website doesn't have it yet. */
export const missing = (error: unknown) => error instanceof ApiError && error.status === 404;

export function useHubsSummary(range: HubsRange) {
  return useQuery({
    queryKey: ["admin", "hubs", "summary", range],
    // Keep the last range's table up while the next one loads.
    placeholderData: keepPreviousData,
    queryFn: async () => (await api<{ summary: HubsSummary }>(`${HUBS_API}?range=${range}`)).summary,
  });
}

/** Adds or removes an email a student paid with (the website's /api/admin/payment-emails), then refreshes the figures. */
export async function savePaymentEmail(method: "POST" | "DELETE", userId: string, email: string) {
  await api("/api/admin/payment-emails", { method, body: { userId, email } });
  await queryClient.invalidateQueries({ queryKey: ["admin", "hubs", "summary"] });
}
