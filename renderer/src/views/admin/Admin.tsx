import { adminPages, useAdminAccess, type AdminPage } from "../../lib/admin";
import { AdminMetrics } from "./Metrics";
import { AdminHubs } from "./Hubs";
import { AdminRoadmap } from "./Roadmap";
import { AdminModeration } from "./Moderation";
import { AdminCoursesAdmin } from "./CoursesAdmin";
import { AdminBugs } from "./Bugs";
import { AdminSupport } from "./Support";

/* Admin: the website's /admin, for the people it lets in. A page they may not open shows their first one instead. */
export function Admin({ page, id }: { page: AdminPage; id?: string }) {
  const access = useAdminAccess();
  const pages = adminPages(access.data);
  if (access.isLoading) return null;
  if (!pages.length) return <div className="empty-state"><p>Admin isn't available on your account.</p></div>;
  const shown = pages.includes(page) ? page : pages[0];
  const key = `${shown}:${id ?? ""}`;
  switch (shown) {
    case "support": return <AdminSupport key={shown} id={id} />;
    case "metrics": return <AdminMetrics key={key} id={id} />;
    case "hubs": return <AdminHubs key={key} id={id} />;
    case "roadmap": return <AdminRoadmap key={key} id={id} />;
    case "moderation": return <AdminModeration key={key} id={id} />;
    case "bugs": return <AdminBugs key={key} id={id} />;
    case "courses": return <AdminCoursesAdmin key={key} id={id} />;
  }
}
