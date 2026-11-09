import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { api, keys, queryClient, useChannels, type Channel, type Workspace } from "../../lib/api";
import { channelName } from "../../lib/ui";

/*
  Coming-soon channels (creatorhive-app docs/coming-soon-channels.md). The
  CreatorHive list asks for them with ?comingSoon=1; each is listed with a
  lock + "Soon" tag after every other channel. Everyone but the owner gets the
  locked screen instead of the channel: nothing inside it is asked for (no
  messages, read mark, composer, members, pins or realtime). The owner opens it
  as usual, with a bar to open it to everyone.
*/

/**
 * Every coming-soon row after all the others, in the server's order (the
 * server sends them last, in a fixed order); the others keep the order given.
 */
export function soonLast<T>(rows: T[], channel: (row: T) => Channel, server: readonly Channel[] = []): T[] {
  const at = (row: T) => server.findIndex((c) => c.id === channel(row).id);
  const soon = rows.filter((row) => channel(row).comingSoon).sort((a, b) => at(a) - at(b));
  return [...rows.filter((row) => !channel(row).comingSoon), ...soon];
}

/** The "Soon" tag beside a coming-soon channel's name. */
export function SoonTag() {
  return <span className="soon-tag" aria-label="Coming soon"><Lock aria-hidden />Soon</span>;
}

/** What a locked coming-soon channel shows: its name, when it opens and what it will be for. */
export function LockedChannel({ channel }: { channel: Channel }) {
  const name = channelName(channel.name);
  return (
    <div className="convo">
      <div className="convo-main">
        <div className="mhead">
          <h1>#{name}<SoonTag /></h1>
        </div>
        <div className="soon-screen">
          <div className="soon-card">
            <div className="soon-icon" aria-hidden><Lock /></div>
            <div className="soon-name"># {name}</div>
            <div className="soon-message">{channel.comingSoonMessage || "Coming soon"}</div>
            {channel.description ? <p className="soon-description">{channel.description}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The owner's bar in a coming-soon channel: only they can open it; one click opens it to everyone. */
export function ComingSoonOwnerBar({ channelId }: { channelId: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const data = await api<{ channel?: { comingSoon: boolean; comingSoonMessage: string | null } }>(
        `/api/channels/${channelId}/coming-soon`, { method: "PATCH", body: { comingSoon: false } },
      );
      queryClient.setQueryData<Channel[]>(keys.channels("creatorhive"), (list) => list?.map((c) => c.id === channelId
        ? { ...c, comingSoon: data.channel?.comingSoon ?? false, comingSoonLocked: false, comingSoonMessage: data.channel?.comingSoonMessage ?? null, isPrivate: false }
        : c));
      void queryClient.invalidateQueries({ queryKey: keys.channels("creatorhive") });
    } catch {
      window.alert("The channel could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="soon-owner" role="status">
      <Lock aria-hidden />
      <span className="soon-owner-text"><strong>Coming soon.</strong> Only you can open and post here. Everyone else sees the locked screen.</span>
      <button className="btn honey" disabled={busy} onClick={() => void open()}>{busy ? "Opening…" : "Open to everyone"}</button>
    </div>
  );
}

/**
 * A channel's screen: the locked screen for a coming-soon channel this member
 * can't open, otherwise the conversation. CreatorHive waits for its list so a
 * locked channel never starts loading.
 */
export function ChannelGate({ id, workspace, children }: { id: string; workspace: Workspace; children: ReactNode }) {
  const creatorHive = workspace === "creatorhive";
  const { data, isPending } = useChannels("creatorhive", creatorHive);
  if (!creatorHive) return <>{children}</>;
  if (isPending) return <div className="convo" />;
  const channel = data?.find((c) => c.id === id);
  if (channel?.comingSoonLocked) return <LockedChannel channel={channel} />;
  return <>{children}</>;
}
