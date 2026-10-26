import { ch } from "./bridge";
import { queryClient, keys, type Channel, type Conversation } from "./api";
import { nav, type Location, type View } from "./nav";

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
  // A thread and a message in it (notifications, search, Copy link). `m` is what 2.0.0's Copy link wrote.
  const threadId = params.get("thread") ?? undefined;
  const messageId = params.get("message") ?? params.get("m") ?? undefined;
  // A DM or channel opens inside Home, unless the DMs view is already open.
  const chatSection = here.section === "dms" ? "dms" : "home";

  // Paths with an id in them.
  const deal = /^\/hub\/deals\/([0-9a-f-]{36})$/i.exec(url.pathname)?.[1];
  if (deal) return { ws: "ch", section: "hub", view: { kind: "hub", page: "deals", dealId: deal } };
  const course = /^\/courses\/([^/]+)$/.exec(url.pathname)?.[1];
  if (course) return { ws: "ch", section: "learn", view: { kind: "course", id: decodeURIComponent(course), lessonId: params.get("lesson") ?? undefined } };
  const page = /^\/resources\/([0-9a-f-]{36})$/i.exec(url.pathname)?.[1] ?? (url.pathname === "/resources" ? params.get("page") : null);
  if (page) return { ws: "ch", section: "learn", view: { kind: "resource", id: page } };
  // The website's Admin: /admin, /admin/<page>, /admin/hubs/<id>, /admin/courses/<id>.
  const admin = /^\/admin(?:\/(metrics|hubs|roadmap|moderation|courses)(?:\/([^/]+))?)?\/?$/.exec(url.pathname);
  if (admin) return { ws: "ch", section: "admin", view: { kind: "admin", page: (admin[1] ?? "metrics") as "metrics", id: admin[2] ? decodeURIComponent(admin[2]) : undefined } };
  const guide = /^\/library\/resources\/([\w-]+)$/.exec(url.pathname)?.[1];
  if (guide) return { ws: "ch", section: "learn", view: guide === "ai-script-writer" ? { kind: "script-writer" } : { kind: "improve-resource", slug: guide } };

  switch (url.pathname) {
    case "/":
      return { ws: "ch", section: "home", view: params.get("post") ? { kind: "feed", postId: params.get("post")! } : { kind: "feed" } };
    case "/messages": {
      const id = params.get("convo");
      if (!id) return { ws: here.ws, section: "dms", view: { kind: "dms-home" } };
      const inHeySocial = queryClient.getQueryData<Conversation[]>(keys.conversations("heysocial"))?.some((c) => c.id === id);
      const ws = inHeySocial ? "hs" : "ch";
      // CreatorHive DMs reply inline, so there a thread link shows its message instead.
      const view: View = ws === "hs" ? { kind: "dm", id, threadId, messageId } : { kind: "dm", id, messageId: messageId ?? threadId };
      return { ws, section: ws === here.ws ? chatSection : "home", view };
    }
    case "/channels": {
      const slug = params.get("c");
      for (const workspace of ["creatorhive", "heysocial"] as const) {
        const channel = queryClient.getQueryData<Channel[]>(keys.channels(workspace))?.find((c) => c.slug === slug || c.id === slug);
        if (channel) return { ws: workspace === "heysocial" ? "hs" : "ch", section: "home", view: { kind: "channel", id: channel.id, threadId, messageId } };
      }
      return null;
    }
    case "/hey-social": {
      const slug = params.get("c");
      const channel = slug
        ? queryClient.getQueryData<Channel[]>(keys.channels("heysocial"))?.find((c) => c.slug === slug)
        : null;
      if (slug && !channel) return null;
      return { ws: "hs", section: "home", view: channel ? { kind: "channel", id: channel.id, threadId, messageId } : { kind: "threads" } };
    }
    case "/hey-social/dm": {
      const id = params.get("convo");
      return { ws: "hs", section: here.ws === "hs" ? chatSection : "home", view: id ? { kind: "dm", id, threadId, messageId } : { kind: "dms-home" } };
    }
    case "/hey-social/threads":
      return { ws: "hs", section: "home", view: { kind: "threads" } };
    case "/hey-social/saved":
      return { ws: "hs", section: "later", view: { kind: "saved" } };
    case "/hey-social/people":
      return { ws: "hs", section: "home", view: { kind: "hs-people" } };
    case "/hey-social/activity":
      return { ws: "hs", section: "activity", view: { kind: "activity" } };
    case "/hub":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "deals" } };
    case "/hub/dashboard":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "dashboard" } };
    case "/hub/clients":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "clients" } };
    case "/hub/cash":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "dashboard" } };
    case "/hub/deals":
      return { ws: "ch", section: "hub", view: { kind: "hub", page: "deals" } };
    case "/events":
      return { ws: "ch", section: "home", view: { kind: "events", eventId: params.get("event") ?? undefined } };
    case "/today":
      return { ws: "ch", section: "home", view: { kind: "today" } };
    case "/resources":
      return { ws: "ch", section: "learn", view: { kind: "learn", page: "resources" } };
    case "/library":
      return { ws: "ch", section: "learn", view: params.get("id") ? { kind: "resource", id: params.get("id")! } : { kind: "learn", page: "improve" } };
    case "/hey-social/people":
    case "/hey-social/search":
      return { ws: "hs", section: "home", view: { kind: "threads" } };
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

/* Website pages that are a window or a dialog in the app rather than a place. */
const SETTINGS_TABS: Record<string, Parameters<typeof openSettings>[0]> = { "/settings": "account", "/settings/invoice": "hub" };

/**
 * Go to a website path in the app. Only the website's legal and public pages
 * (Terms, Privacy, Support, a client's invoice link) are left to the browser:
 * the app has no copy of them. Admin has its own section now.
 */
export async function openPath(target: string) {
  const location = locationForPath(target);
  if (location) {
    // The same place again (a second click on a notification after closing its thread): the open conversation shows it again.
    if (JSON.stringify(location) === JSON.stringify(nav.get())) window.dispatchEvent(new CustomEvent("ch:reopen", { detail: location.view }));
    nav.open(location.view, location.section, location.ws);
    return;
  }
  const pathname = new URL(target, "https://app.invalid").pathname;
  if (pathname in SETTINGS_TABS) { openSettings(SETTINGS_TABS[pathname]); return; }
  if (pathname === "/hey-social/settings") { nav.workspace("hs"); window.dispatchEvent(new Event("ch:hs-preferences")); return; }
  if (pathname === "/profile") {
    const { user } = await ch.auth.session();
    if (user) { nav.open({ kind: "profile", id: user.id }, "home", "ch"); return; }
  }
  ch.app.openSite(target);
}

/** A link's address, as a path on our own website, or null for anywhere else. */
export async function ownSitePath(href: string): Promise<string | null> {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    const { origin } = await ch.info();
    const ours = [origin, "https://community.creatorhiveacademy.com", "https://creatorhive-app.vercel.app"];
    return ours.includes(url.origin) ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/** The Settings window, on one of its tabs. */
export function openSettings(tab?: "general" | "notifications" | "appearance" | "shortcuts" | "hub" | "heysocial" | "privacy" | "account") {
  ch.window.popout({ kind: "settings", id: tab ?? "main" });
}
