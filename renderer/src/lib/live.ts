import { useEffect, useState } from "react";
import { ch } from "./bridge";
import { api, queryClient } from "./api";
import { addMessage, countsChanged, markRead, mergeCounts, messageKeys, patchMessage, refreshReactions, removeMessage, type Message, type Thread } from "./community";

/*
  Live updates for an open channel or DM: new, edited and deleted messages,
  reactions, pins and typing, straight into the cached list. A missed event
  is harmless: lists refetch when the window comes back and on reconnect.
*/
export function useLiveThread(where: Thread, realtimeChannel: string | null, meId: string) {
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});

  useEffect(() => {
    if (!realtimeChannel) return;
    ch.realtime.watch(realtimeChannel);
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    const off = ch.realtime.onMessage(({ channel, name, data }) => {
      if (channel !== realtimeChannel) return;
      const payload = (data ?? {}) as Record<string, unknown>;
      switch (name) {
        case "message:new": {
          const message = payload as unknown as Message;
          addMessage(where, message);
          if (message.author?.id !== meId) {
            setTyping((current) => {
              const next = { ...current };
              delete next[message.author.id];
              return next;
            });
            // Seen, since it's open: tell the server (debounced).
            clearTimeout(readTimer);
            readTimer = setTimeout(() => {
              if (document.hasFocus()) void markRead(where);
            }, 800);
          }
          break;
        }
        case "message:updated":
          patchMessage(where, String(payload.messageId), (m) => ({
            ...m, body: String(payload.body ?? m.body), bodyHtml: (payload.bodyHtml as string) ?? m.bodyHtml, editedAt: (payload.editedAt as string) ?? m.editedAt,
          }));
          break;
        case "message:deleted":
          removeMessage(where, String(payload.messageId));
          if (payload.parentMessageId) void queryClient.invalidateQueries({ queryKey: messageKeys.list(where) });
          break;
        case "reaction:updated": {
          const id = String(payload.messageId);
          const counts = (payload.reactions ?? {}) as Record<string, { count: number }>;
          let changed = false;
          patchMessage(where, id, (m) => {
            changed ||= countsChanged(m.reactions, counts);
            return { ...m, reactions: mergeCounts(m.reactions, counts) };
          });
          if (changed) refreshReactions(where, id);
          break;
        }
        case "message:pinned":
          patchMessage(where, String(payload.messageId), (m) => ({ ...m, pin: (payload.pin as Message["pin"]) ?? null }));
          void queryClient.invalidateQueries({ queryKey: ["pins", where.id] });
          break;
        case "typing": {
          const userId = String(payload.userId ?? "");
          if (!userId || userId === meId) break;
          setTyping((current) => ({ ...current, [userId]: { name: String(payload.name ?? "Someone"), until: Number(payload.expiresAt ?? Date.now() + 3000) } }));
          break;
        }
      }
    });
    return () => {
      clearTimeout(readTimer);
      off();
      ch.realtime.unwatch(realtimeChannel);
    };
  }, [where.kind, where.id, realtimeChannel, meId]);

  // Expire typing names.
  useEffect(() => {
    const names = Object.values(typing);
    if (names.length === 0) return;
    const next = Math.min(...names.map((t) => t.until)) - Date.now();
    const timer = setTimeout(() => {
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, t]) => t.until > Date.now())));
    }, Math.max(100, next));
    return () => clearTimeout(timer);
  }, [typing]);

  return Object.values(typing).filter((t) => t.until > Date.now()).map((t) => t.name);
}

/** Tells the others you're typing, at most every 2.5 seconds. */
export function typingSignal(realtimeChannel: string | null) {
  let last = 0;
  return () => {
    if (!realtimeChannel || Date.now() - last < 2500) return;
    last = Date.now();
    void api("/api/realtime/typing", { method: "POST", body: { channelName: realtimeChannel } }).catch(() => {});
  };
}

export function typingLine(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}
