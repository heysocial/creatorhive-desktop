import { ch } from "./bridge";
import { queryClient, keys, type Channel, type Conversation } from "./api";
import { nav, type Location } from "./nav";

/*
  Notifications, search results and the server all speak in website paths
  (`/messages?convo=…`, `/channels?c=…`). This turns one into a place in the
  app, or returns null for pages the app doesn't have yet, which then open on
  the website in the browser.
*/
export function locationForPath(target: string): Location | null {
  let url: URL;
  try {
    url = new URL(target, "https://app.invalid");
  } catch {
    return null;
  }
  const params = url.searchParams;
  const postHash = /^#post-([0-9a-f-]{36})$/.exec(url.hash)?.[1];
  if (url.pathname === "/" && postHash) params.set("post", postHash);
  const here = nav.get();
  // A DM or channel opens inside Home, unless the DMs view is already open.
  const chatSection = here.section === "dms" ? "dms" : "home";

  switch (url.pathname) {
    case "/":
      return { ws: "ch", section: "home", view: params.get("post") ? { kind: "feed", postId: params.get("post")! } : { kind: "feed" } };
    case "/messages": {
      const id = params.get("convo");
      if (!id) return { ws: here.ws, section: "dms", view: { kind: "dms-home" } };
      const inHeySocial = queryClient.getQueryData<Conversation[]>(keys.conversations("heysocial"))?.some((c) => c.id === id);
      const ws = inHeySocial ? "hs" : "ch";
      return { ws, section: ws === here.ws ? chatSection : "home", view: { kind: "dm", id } };
    }
    case "/channels": {
      const slug = params.get("c");
      for (const workspace of ["creatorhive", "heysocial"] as const) {
        const channel = queryClient.getQueryData<Channel[]>(keys.channels(workspace))?.find((c) => c.slug === slug || c.id === slug);
        if (channel) return { ws: workspace === "heysocial" ? "hs" : "ch", section: "home", view: { kind: "channel", id: channel.id } };
      }
      return null;
    }
    case "/hey-social": {
      const slug = params.get("c");
      const channel = slug
        ? queryClient.getQueryData<Channel[]>(keys.channels("heysocial"))?.find((c) => c.slug === slug)
        : null;
      if (slug && !channel) return null;
      return { ws: "hs", section: "home", view: channel ? { kind: "channel", id: channel.id } : { kind: "threads" } };
    }
    case "/hey-social/dm": {
      const id = params.get("convo");
      return { ws: "hs", section: here.ws === "hs" ? chatSection : "home", view: id ? { kind: "dm", id } : { kind: "dms-home" } };
    }
    case "/hey-social/threads":
      return { ws: "hs", section: "home", view: { kind: "threads" } };
    case "/hey-social/saved":
      return { ws: "hs", section: "later", view: { kind: "saved" } };
    case "/hey-social/activity":
      return { ws: "hs", section: "activity", view: { kind: "activity" } };
    case "/hub":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "deals" } };
    case "/hub/dashboard":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "dashboard" } };
    case "/hub/clients":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "clients" } };
    case "/events":
      return { ws: "ch", section: "home", view: { kind: "events" } };
    case "/profile":
      return null;
    case "/leaderboard":
      return { ws: "ch", section: "home", view: { kind: "leaderboard" } };
    case "/members":
      return { ws: "ch", section: "home", view: params.get("member") ? { kind: "profile", id: params.get("member")! } : { kind: "members" } };
    case "/courses":
      return { ws: "ch", section: "learn", view: { kind: "learn", page: "courses" } };
    default:
      return null;
  }
}

/** Go to a website path in the app, or on the website if the app has no such page yet. */
export function openPath(target: string) {
  const location = locationForPath(target);
  if (location) nav.open(location.view, location.section, location.ws);
  else ch.app.openSite(target);
}
