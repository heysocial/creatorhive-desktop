import { useEffect, useState } from "react";
import { ch } from "./bridge";
import { queryClient } from "./api";

/*
  The server signals on the member's own channel whenever something they'd see
  changes (a DM arrives, a channel gets a message, a read is recorded
  elsewhere). The lists here simply refetch: one request, always correct.
*/
export function useRealtimeRefresh() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["channels"] });
        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }, 400);
    };
    const off = ch.realtime.onMessage((message) => {
      if (message.channel.startsWith("user:")) refresh();
    });
    return () => {
      clearTimeout(timer);
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
