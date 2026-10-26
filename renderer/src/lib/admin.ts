import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/*
  What of Admin this person may open, from the website (GET /api/admin/access,
  which reads the same rules as its own pages): the owner sees every tab,
  Lucien only Hubs, the team the course editor, students nothing. Only decides
  what to show; every admin route still checks for itself.
*/

export type AdminPage = "metrics" | "hubs" | "roadmap" | "moderation" | "courses";

export interface AdminAccess {
  tabs: Exclude<AdminPage, "courses">[];
  owner: boolean;
  team: boolean;
  courses: boolean;
}

const NONE: AdminAccess = { tabs: [], owner: false, team: false, courses: false };

export function useAdminAccess() {
  return useQuery({
    queryKey: ["admin", "access"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        return await api<AdminAccess>("/api/admin/access");
      } catch {
        return NONE;
      }
    },
  });
}

/** The Admin pages this person may open, in sidebar order. */
export function adminPages(access: AdminAccess | undefined): AdminPage[] {
  if (!access) return [];
  return [...access.tabs, ...(access.courses ? (["courses"] as const) : [])];
}

/** The owner's open reports, for the Admin badge (the website's sidebar badge). */
export function useOpenReports(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "summary"],
    enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => (await api<{ openReports: number }>("/api/admin/summary")).openReports,
  });
}

export const ADMIN_LABELS: Record<AdminPage, string> = {
  metrics: "Metrics",
  hubs: "Hubs",
  roadmap: "Roadmap",
  moderation: "Moderation",
  courses: "Courses",
};
