import { useEffect, useState } from "react";
import { ch } from "./bridge";
import { api, keys, queryClient, type Channel, type Conversation } from "./api";
import { HS_KEY, type HsSidebar } from "./heysocial";
import { nav } from "./nav";

const FEED_CHANNEL = "feed:community";
const PRESENCE_CHANNEL = "presence:global";

/*
  The server signals on the member's own channel whenever something they'd see
  changes (a DM arrives, a channel gets a message, the Hub moves, a
  notification lands), and on feed:community when a post changes. Signals
  carry ids, not content, so the affected lists simply refetch.
*/
export function useRealtimeRefresh(userId: string, { sidebar = true }: { sidebar?: boolean } = {}) {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const soon = (key: string[], delay = 400) => {
      const id = key.join("/");
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => void queryClient.invalidateQueries({ queryKey: key }), delay));
    };
    const heard = new Map<string, "ch" | "hs">(); // channel:<id> the sidebar listens on for unread state, and whose list it is in
    ch.realtime.watch(FEED_CHANNEL);
    ch.realtime.watch(PRESENCE_CHANNEL);
    // Presence also changes with time (online → away → offline) without a signal.
    const decay = setInterval(() => soon(["conversations"]), 120_000);
    const off = ch.realtime.onMessage((message) => {
      if (message.channel === `user:${userId}`) {
        switch (message.name) {
          case "hub:changed":
          case "hub:sharing":
            soon(["hub"]);
            break;
          case "notifications:changed":
            soon(["notifications"]);
            break;
          case "huddles:changed":
            soon(["hey-social", "huddles"], 150);
            break;
          default:
            soon(["channels"]);
            soon(["conversations"]);
            soon([...HS_KEY]);
        }
        return;
      }
      if (heard.has(message.channel)) {
        if (message.name !== "message:new" && message.name !== "message:deleted") return;
        const data = message.data as { author?: { id?: string }; parentMessageId?: string | null } | null;
        // Our own posts, thread replies and the channel being read here don't change what the sidebar shows.
        if (data?.author?.id === userId || data?.parentMessageId) return;
        const { view } = nav.get();
        if (view.kind === "channel" && `channel:${view.id}` === message.channel && document.hasFocus()) return;
        soon(heard.get(message.channel) === "hs" ? [...HS_KEY] : ["channels"], 1500);
        return;
      }
      if (message.channel === PRESENCE_CHANNEL) {
        soon(["conversations"], 1500);
        soon(["members"], 5000);
        return;
      }
      if (message.channel === FEED_CHANNEL) {
        const postId = (message.data as { postId?: string } | null)?.postId;
        if (message.name === "post:comments" && postId) soon(["comments", postId], 200);
        soon(["posts"], message.name === "post:created" ? 800 : 300);
        if (postId) soon(["post", postId], 300);
        soon(["posts-unread"], 1000);
      }
    });
    /*
      Plain channel posts send nothing on the member's own channel, so the
      sidebar listens on each channel it lists (the token already lets it) and
      refetches the unread state, debounced. A muted Hey Social channel isn't
      listened to at all: it stays quiet.
      Conversations started after the connection came up need a fresh token
      before they can be heard; the main process fetches one when the list
      gains a DM (or group, or Hey Social DM) its token doesn't cover.
    */
    const syncHeard = () => {
      const names = new Map<string, "ch" | "hs">();
      if (sidebar) {
        for (const c of queryClient.getQueryData<Channel[]>(keys.channels("creatorhive")) ?? []) if (c.joined || !c.isPrivate) names.set(`channel:${c.id}`, "ch");
        for (const c of queryClient.getQueryData<HsSidebar>(HS_KEY)?.channels ?? []) if (c.joined && !c.muted) names.set(`channel:${c.id}`, "hs");
      }
      for (const [name, list] of names) {
        if (!heard.has(name)) ch.realtime.watch(name);
        heard.set(name, list);
      }
      for (const name of [...heard.keys()]) if (!names.has(name)) { heard.delete(name); ch.realtime.unwatch(name); }
    };
    const offCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const [root, sub] = event.query.queryKey as string[];
      if (root === "conversations" || (root === "hey-social" && sub === "sidebar")) {
        const list = root === "conversations" ? (event.query.state.data as Conversation[] | undefined) : (event.query.state.data as HsSidebar | undefined)?.dms;
        ch.realtime.ensure((list ?? []).map((c) => c.realtimeChannel).filter(Boolean));
        if (root === "conversations" && sidebar) ackDelivery(list ?? [], userId);
      }
      if (root === "channels" || (root === "hey-social" && sub === "sidebar")) syncHeard();
    });
    syncHeard();
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(decay);
      off();
      offCache();
      heard.forEach((_list, name) => ch.realtime.unwatch(name));
      ch.realtime.unwatch(FEED_CHANNEL);
      ch.realtime.unwatch(PRESENCE_CHANNEL);
    };
  }, [userId, sidebar]);
}

/*
  "I have these messages", as the website and iPhone tell the server
  (/api/dms/delivery), so the sender sees Delivered. The newest message of
  each 1:1 conversation from someone else, once, a few seconds after the list loads.
*/
const acked = new Map<string, string>();
const pendingAcks = new Map<string, string>();
let ackTimer: ReturnType<typeof setTimeout> | null = null;
function ackDelivery(conversations: Conversation[], meId: string) {
  for (const c of conversations) {
    if (c.isGroup || !c.lastMessageId || c.lastMessageAuthorId === meId || acked.get(c.id) === c.lastMessageId) continue;
    pendingAcks.set(c.id, c.lastMessageId);
  }
  if (pendingAcks.size === 0 || ackTimer) return;
  ackTimer = setTimeout(() => {
    ackTimer = null;
    const acks = [...pendingAcks].map(([conversationId, messageId]) => ({ conversationId, messageId }));
    pendingAcks.clear();
    void api("/api/dms/delivery", { method: "POST", body: { acks } })
      .then(() => acks.forEach((a) => acked.set(a.conversationId, a.messageId)))
      .catch(() => {});
  }, 3000);
}

/** "Active now" for others: a heartbeat while the window is in use, away when it isn't. */
export function usePresence() {
  useEffect(() => {
    let focused = document.hasFocus();
    const beat = (state: "online" | "away") => void api("/api/presence", { method: "POST", body: { state } }).catch(() => {});
    beat(focused ? "online" : "away");
    const timer = setInterval(() => focused && beat("online"), 60_000);
    const off = ch.window.onFocus((value) => {
      focused = value;
      if (value) beat("online");
    });
    return () => {
      clearInterval(timer);
      off();
    };
  }, []);
}

/** The live connection's state, for the "Reconnecting…" hint. */
export function useConnectionState() {
  const [state, setState] = useState("connected");
  useEffect(() => ch.realtime.onState(setState), []);
  return state;
}
