import { queryClient, keys, type Channel } from "./api";
import type { Location } from "./nav";

/*
  The website page that shows the same thing as a place in the app. Used for
  "Open on the website" (while a screen is still being built) and Copy link.
*/
export function sitePathFor({ ws, view }: Location): string {
  const workspace = ws === "hs" ? "heysocial" : "creatorhive";
  switch (view.kind) {
    case "channel": {
      const slug = queryClient.getQueryData<Channel[]>(keys.channels(workspace))?.find((c) => c.id === view.id)?.slug ?? "";
      return ws === "hs" ? `/hey-social?c=${encodeURIComponent(slug)}` : `/channels?c=${encodeURIComponent(slug)}`;
    }
    case "dm":
      return ws === "hs" ? `/hey-social/dm?convo=${encodeURIComponent(view.id)}` : `/messages?convo=${encodeURIComponent(view.id)}`;
    case "dms-home":
      return ws === "hs" ? "/hey-social/dm" : "/messages";
    case "events":
      return "/events";
    case "profile":
      return `/members?member=${encodeURIComponent(view.id)}`;
    case "feed":
      return view.postId ? `/?post=${encodeURIComponent(view.postId)}` : "/";
    case "leaderboard":
      return "/leaderboard";
    case "members":
      return "/members";
    case "hub":
      return view.page === "deals" || view.page === "invoices" ? "/hub" : `/hub/${view.page}`;
    case "learn":
      return view.page === "courses" ? "/courses" : view.page === "resources" ? "/resources" : "/library";
    case "threads":
      return "/hey-social/threads";
    case "saved":
      return "/hey-social/saved";
    case "mentions":
    case "activity":
      return ws === "hs" ? "/hey-social/activity" : "/";
    default:
      return ws === "hs" ? "/hey-social" : "/";
  }
}
