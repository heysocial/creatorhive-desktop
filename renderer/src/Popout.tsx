import { useEffect, useState } from "react";
import { ch, type SessionUser } from "./lib/bridge";
import { queryClient, useChannels, useConversations, useHeySocialAccess } from "./lib/api";
import { useRealtimeRefresh } from "./lib/realtime";
import { Conversation, ThreadPanel } from "./views/messages/Conversation";

/*
  A pop-out window (⌘⇧O): one DM, channel or thread, nothing else. It shares
  the main window's session and live connection through the main process.
*/
export function Popout({ kind, id }: { kind: string; id: string }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    void ch.auth.session().then(({ user: u }) => setUser(u ?? null));
    return ch.auth.onChanged(() => {
      queryClient.clear();
      window.close();
    });
  }, []);
  if (user === undefined) return <div className="popout-shell" />;
  if (user === null) return <div className="popout-shell"><div className="empty-state">Sign in to CreatorHive first.</div></div>;
  return <PopoutBody kind={kind} id={id} user={user} />;
}

function PopoutBody({ kind, id, user }: { kind: string; id: string; user: SessionUser }) {
  useRealtimeRefresh(user.id);
  // The workspace isn't in the address: look the id up in Hey Social Inc.'s lists.
  const hs = useHeySocialAccess().data === true;
  const hsChannels = useChannels("heysocial", hs).data;
  const hsConversations = useConversations("heysocial", hs).data;
  const inHeySocial = Boolean(hsChannels?.some((c) => c.id === id) || hsConversations?.some((c) => c.id === id));
  const workspace = inHeySocial ? "heysocial" : "creatorhive";
  if (kind === "thread") {
    const [whereKind, whereId, parentId] = id.split(":");
    if ((whereKind !== "channel" && whereKind !== "dm") || !whereId || !parentId) return null;
    const realtime = whereKind === "channel" ? `channel:${whereId}` : null;
    return (
      <div className="popout-shell">
        <div className="popout-drag" />
        <ThreadPanel where={{ kind: whereKind, id: whereId }} parentId={parentId} user={user} title="" popout realtimeChannel={realtime} />
      </div>
    );
  }
  if (kind !== "dm" && kind !== "channel") return null;
  return (
    <div className="popout-shell">
      <main className="main popout-main">
        <Conversation where={{ kind, id }} user={user} workspace={workspace} popout />
      </main>
    </div>
  );
}
