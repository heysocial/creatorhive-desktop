import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { locationForPath, openLocation, openPath } from "../../lib/links";

/** One Admin → Announcements message, as the website's /api/announcements/:id gives it. */
interface Announcement {
  id: string;
  title: string;
  body: string;
  screenPath: string;
  buttonLabel: string;
  sentAt: string;
  sender: string | null;
}

/*
  The whole announcement: where its notification and its Activity row land, so
  a message the notification cut short can be read in full. The button goes
  on to the screen it was sent for ("Open Hub"). The website's
  /announcements/<id> page shows the same.
*/
export function AnnouncementPage({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["announcement", id],
    queryFn: () => api<{ announcement: Announcement }>(`/api/announcements/${encodeURIComponent(id)}`).then((data) => data.announcement),
  });
  const announcement = query.data;

  const openScreen = () => {
    if (!announcement) return;
    const location = locationForPath(announcement.screenPath);
    if (location) openLocation(location);
    else void openPath(announcement.screenPath);
  };

  let body;
  if (query.isPending) body = <div className="empty-state"><p>Loading…</p></div>;
  else if (!announcement) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    body = (
      <div className="empty-state">
        <div>
          <p>{missing ? "That announcement isn't here. It may have been meant for someone else." : "The announcement didn't load."}</p>
          {missing ? null : <button className="btn" style={{ marginTop: 10 }} onClick={() => void query.refetch()}>Try again</button>}
        </div>
      </div>
    );
  } else {
    const sent = new Date(announcement.sentAt).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
    body = (
      <article className="ann-page">
        <p className="ann-meta">{announcement.sender ? `${announcement.sender} · ${sent}` : sent}</p>
        <h2 className="ann-title">{announcement.title}</h2>
        <p className="ann-body">{announcement.body}</p>
        <button className="btn honey lg" onClick={openScreen}>{announcement.buttonLabel}</button>
      </article>
    );
  }

  return (
    <div className="page">
      <div className="mhead"><h1><Megaphone />Announcement</h1></div>
      <div className="page-body scroll">{body}</div>
    </div>
  );
}
