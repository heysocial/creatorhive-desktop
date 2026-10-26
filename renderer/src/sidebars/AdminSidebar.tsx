import type { ReactNode } from "react";
import { BarChart3, BookOpen, Flag, Map, Wallet } from "lucide-react";
import { ADMIN_LABELS, adminPages, useAdminAccess, useOpenReports, type AdminPage } from "../lib/admin";
import { SidebarHead, SidebarItem } from "./parts";

const ICONS: Record<AdminPage, ReactNode> = {
  metrics: <BarChart3 />,
  hubs: <Wallet />,
  roadmap: <Map />,
  moderation: <Flag />,
  courses: <BookOpen />,
};

/* Admin's pages, only the ones this person may open (the website's Admin tabs, plus the course editor). */
export function AdminSidebar() {
  const access = useAdminAccess().data;
  const reports = useOpenReports(Boolean(access?.tabs.includes("moderation"))).data;
  return (
    <>
      <SidebarHead title="Admin" />
      <div className="sb-scroll">
        {adminPages(access).map((page) => (
          <SidebarItem key={page} icon={ICONS[page]} label={ADMIN_LABELS[page]} view={{ kind: "admin", page }}
            count={page === "moderation" && reports ? reports : undefined} />
        ))}
      </div>
    </>
  );
}
