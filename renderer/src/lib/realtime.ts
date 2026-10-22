import { useEffect, useState } from "react";
import { ch } from "./bridge";
import { api, queryClient } from "./api";

const FEED_CHANNEL = "feed:community";

/*
  The server signals on the member's own channel whenever something they'd see
  changes (a DM arrives, a channel gets a message, the Hub moves, a
  notification lands), and on feed:community when a post changes. Signals
  carry ids, not content, so the affected lists simply refetch.
*/
export function useRealtimeRefresh(userId: string) {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const soon = (key: string[], delay = 400) => {
      const id = key.join("/");
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => void queryClient.invalidateQueries({ queryKey: key }), delay));
    };
    ch.realtime.watch(FEED_CHANNEL);
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
          default:
            soon(["channels"]);
            soon(["conversations"]);
        }
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
    return () => {
      timers.forEach(clearTimeout);
      off();
      ch.realtime.unwatch(FEED_CHANNEL);
    };
  }, [userId]);
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
