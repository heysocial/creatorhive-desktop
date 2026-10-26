import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, queryClient } from "./api";

/*
  Admin → Bugs, read from the website's JSON (creatorhive-app lib/admin/bugs.ts,
  app/api/admin/bugs/**), the same data its /admin/bugs page draws:

    GET   /api/admin/bugs?status=&platform=&q=&tz=        → BugList
    GET   /api/admin/bugs/<fingerprint>?offset=&limit=&tz= → BugDetail
    PATCH /api/admin/bugs/<fingerprint> { status }

  The owner's alone; anyone else gets a 404, and Admin shows the page only
  when /api/admin/access lists "bugs".
*/

export type BugPlatform = "web" | "ios" | "mac" | "server";
export type BugStatus = "new" | "investigating" | "fixed" | "ignored";
export type BugStatusFilter = BugStatus | "open" | "all";
export type BugPlatformFilter = BugPlatform | "all";

export const BUG_STATUSES: BugStatus[] = ["new", "investigating", "fixed", "ignored"];
export const PLATFORM_LABEL: Record<BugPlatform, string> = { web: "Website", ios: "iPhone", mac: "Mac", server: "Server" };
export const STATUS_LABEL: Record<BugStatus, string> = { new: "New", investigating: "Investigating", fixed: "Fixed", ignored: "Ignored" };

/** The website's Live: every 15 seconds while the window shows the page. */
export const BUGS_LIVE_MS = 15_000;

export interface BugGroup {
  fingerprint: string;
  title: string;
  detail: string | null;
  message: string;
  kind: string;
  kindLabel: string;
  platform: BugPlatform;
  platformLabel: string;
  version: string | null;
  versionLabel: string | null;
  where: string | null;
  screen: string;
  times: number;
  people: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: BugStatus;
  statusChangedAt: string | null;
  source: "app" | "vercel";
  /** Occurrences per day, oldest first, today last. 14 entries. */
  daily: number[];
}

export interface BugList {
  kpis: { newThisWeek: number; newSinceYesterday: number; errorsToday: number; errorsYesterday: number; peopleThisWeek: number; members: number; open: number };
  counts: { status: Record<BugStatusFilter, number>; platform: Record<BugPlatformFilter, number> };
  groups: BugGroup[];
  truncated: boolean;
  generatedAt: string;
}

export interface BugOccurrence {
  id: string;
  at: string;
  user: { id: string; name: string } | null;
  platform: BugPlatform;
  route: string | null;
  build: string;
}

export interface BugDetail {
  group: BugGroup;
  who: { students: number; team: number; owner: number; signedOutTimes: number };
  versions: Array<{ version: string | null; label: string; count: number }>;
  screens: Array<{ screen: string; where: string | null; count: number }>;
  people: Array<{ id: string; name: string; avatarUrl: string | null; role: string; platform: BugPlatform; device: string; times: number; lastSeenAt: string }>;
  occurrences: { items: BugOccurrence[]; total: number; offset: number; limit: number; hasMore: boolean };
  latest: { at: string; message: string; stack: string | null; componentStack: string | null } | null;
  statusChangedBy: { id: string; name: string } | null;
  related: Array<{ fingerprint: string; platform: BugPlatform; platformLabel: string; title: string; where: string | null; status: BugStatus; times: number; lastSeenAt: string }>;
  claudeText: string;
  url: string;
}

export interface BugFilters { status: BugStatusFilter; platform: BugPlatformFilter; q: string }

function zone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

const BADGE_KEY = ["admin", "bugs", "badge"] as const;

export function useBugs(filters: BugFilters, live: boolean) {
  return useQuery({
    queryKey: ["admin", "bugs", "list", filters],
    placeholderData: keepPreviousData,
    refetchInterval: live ? BUGS_LIVE_MS : false,
    queryFn: async () => {
      const params = new URLSearchParams({ status: filters.status, platform: filters.platform, tz: zone() });
      if (filters.q) params.set("q", filters.q);
      const list = await api<BugList>(`/api/admin/bugs?${params}`);
      // Unfiltered by platform and search, its New count is the sidebar's badge.
      if (filters.platform === "all" && !filters.q) queryClient.setQueryData(BADGE_KEY, list.counts.status.new);
      return list;
    },
  });
}

/** New error groups, for the Bugs badge in Admin's sidebar (the website's Admin tab badge). */
export function useNewBugCount(enabled: boolean) {
  return useQuery({
    queryKey: BADGE_KEY,
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await api<BugList>(`/api/admin/bugs?status=new&tz=${encodeURIComponent(zone())}`)).counts.status.new,
  });
}

export function useBug(fingerprint: string, live: boolean) {
  return useQuery({
    queryKey: ["admin", "bugs", "detail", fingerprint],
    refetchInterval: live ? BUGS_LIVE_MS : false,
    queryFn: () => api<BugDetail>(`/api/admin/bugs/${encodeURIComponent(fingerprint)}?tz=${encodeURIComponent(zone())}`),
  });
}

/** Occurrences after the first page, 200 at a time (the route's most), for Show all. */
export async function bugOccurrencesFrom(fingerprint: string, offset: number): Promise<BugDetail["occurrences"]> {
  const params = new URLSearchParams({ offset: String(offset), limit: "200", tz: zone() });
  return (await api<BugDetail>(`/api/admin/bugs/${encodeURIComponent(fingerprint)}?${params}`)).occurrences;
}

export async function setBugStatus(fingerprint: string, status: BugStatus) {
  await api(`/api/admin/bugs/${encodeURIComponent(fingerprint)}`, { method: "PATCH", body: { status } });
  // The list, its counts and the badge all move with it.
  await queryClient.invalidateQueries({ queryKey: ["admin", "bugs"] });
}
