import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, ExternalLink, Hash, Info, Lock, Pin, SquareArrowOutUpRight, Star, Upload, Users, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch, type SessionUser } from "../../lib/bridge";
import { api, keys, queryClient, useChannels, useConversations, type Workspace } from "../../lib/api";
import {
  addMessage, sendVideoJobs, uploadVideo, watchVideos, deleteMessage, editMessage, flatten, markRead, removeMessage, sendMessage, toggleReaction, useChannelMembers, useMembers, useMessages, useReplies,
  type Author, type Message, type Thread,
} from "../../lib/community";
import { dayLabel } from "../../lib/format";
import { typingLine, typingSignal, useLiveThread } from "../../lib/live";
import { nav } from "../../lib/nav";
import { sitePathFor } from "../../lib/sitePaths";
import { Avatar, channelName } from "../../lib/ui";
import { Composer, type ComposerHandle, type ComposerSend, type MentionCandidate } from "./Composer";
import { MessageRow, type RowActions } from "./MessageRow";
import { RichText } from "../../lib/html";
import { huddleFor, setPrefs, toggleSaved, useHsSidebar, useHuddles } from "../../lib/heysocial";
import { HuddleButton } from "../heysocial/Huddle";

const GROUP_GAP_MS = 5 * 60_000;

function grouped(previous: Message | undefined, message: Message) {
  if (!previous) return false;
  if (previous.author.id !== message.author.id) return false;
  if (new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString()) return false;
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_GAP_MS && !message.pin;
}

function toAuthor(user: SessionUser): Author {
  return { id: user.id, name: user.name, avatarUrl: user.image ?? null, role: user.role ?? "student", instagram: user.instagram ?? null };
}

/** The scrolling list: loads older pages at the top, sticks to the bottom while you're there. */
function MessageList({ where, actions, header, empty }: { where: Thread; actions: RowActions; header?: ReactNode; empty: ReactNode }) {
  const query = useMessages(where);
  const messages = useMemo(() => flatten(query.data), [query.data]);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const restore = useRef<number | null>(null);
  const lastId = messages.at(-1)?.id;
  // Videos still processing (just sent, or arriving from someone else) update themselves when ready.
  useEffect(() => { for (const m of messages) if (m.videoAttachment || m.videoAttachments?.length) watchVideos(where, m); }, [messages, where]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, lastId]);

  // A new conversation starts at the bottom.
  useLayoutEffect(() => {
    atBottom.current = true;
  }, [where.kind, where.id]);

  // Images load after layout; keep the bottom pinned while they do.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [query.isSuccess]);

  function onScroll() {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 300 && query.hasNextPage && !query.isFetchingNextPage) {
      restore.current = el.scrollHeight - el.scrollTop;
      void query.fetchNextPage();
    }
  }

  if (query.isError) {
    return <div className="empty-state"><div className="err-state">Couldn't load messages.<button className="btn" onClick={() => void query.refetch()}>Try again</button></div></div>;
  }

  return (
    <div className="msgs scroll" ref={scroller} onScroll={onScroll}>
      <div className="msgs-inner">
        {query.hasNextPage ? <div className="loading-older">{query.isFetchingNextPage ? "Loading…" : ""}</div> : header}
        {query.isLoading ? <div className="msgs-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} />)}</div> : null}
        {query.isSuccess && messages.length === 0 ? empty : null}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
          return (
            <div key={message.clientMutationId ?? message.id}>
              {newDay ? <div className="day"><span>{dayLabel(message.createdAt)}</span></div> : null}
              <MessageRow message={message} grouped={!newDay && grouped(previous, message)} actions={actions} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Replies beside the channel (or alone, in a pop-out). */
export function ThreadPanel({ where, parentId, user, onClose, title, popout = false, realtimeChannel, workspace = "creatorhive" }: {
  workspace?: Workspace;
  where: Thread;
  parentId: string;
  user: SessionUser;
  onClose?: () => void;
  title: string;
  popout?: boolean;
  realtimeChannel: string | null;
}) {
  const query = useReplies(where, parentId);
  const people = useMentionSearch(where);
  const scroller = useRef<HTMLDivElement>(null);
  const actions = useRowActions(where, user, { inThread: true, heySocial: workspace === "heysocial" });
  const count = query.data?.replies.length ?? 0;
  useLiveThread(where, popout ? realtimeChannel : null, user.id);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, query.isSuccess]);

  return (
    <aside className={`thread ${popout ? "alone" : ""}`}>
      <div className="thread-head">
        <b>Thread</b><span className="muted">{title}</span>
        <div className="acts">
          {!popout ? <button className="iconbtn" title="Open in its own window" onClick={() => ch.window.popout({ kind: "thread", id: `${where.kind}:${where.id}:${parentId}`, title: `Thread · ${title}` })}><SquareArrowOutUpRight /></button> : null}
          {onClose ? <button className="iconbtn" title="Close (Esc)" onClick={onClose}><X /></button> : null}
        </div>
      </div>
      <div className="msgs scroll" ref={scroller}>
        <div className="msgs-inner">
          {query.isLoading ? <div className="msgs-skel">{Array.from({ length: 3 }, (_, i) => <div key={i} />)}</div> : null}
          {query.isError ? <div className="err-state">Couldn't load this thread.</div> : null}
          {query.data ? (
            <>
              <MessageRow message={query.data.parent} grouped={false} actions={actions} inThread />
              <div className="replies-rule"><span>{count === 1 ? "1 reply" : `${count} replies`}</span></div>
              {query.data.replies.map((reply, index) => (
                <MessageRow key={reply.clientMutationId ?? reply.id} message={reply} grouped={grouped(query.data!.replies[index - 1], reply)} actions={actions} inThread />
              ))}
            </>
          ) : null}
        </div>
      </div>
      <Composer compact draftKey={`thread:${parentId}`}
        uploadVideo={workspace === "heysocial" || where.kind === "dm" ? undefined : (file, onProgress) => uploadVideo(where, file, onProgress)}
        voice={where.kind === "dm" || workspace === "heysocial" ? { path: `/api/${where.kind === "channel" ? "channels" : "dms"}/${where.id}/voice`, parentMessageId: parentId, onSent: (m) => m && addMessage(where, m as Message) } : undefined} uploadFolder={workspace === "heysocial" ? (where.kind === "channel" ? where.id : `dm-${where.id}`) : undefined} placeholder="Reply in thread…" searchPeople={where.kind === "channel" ? people : undefined}
        onTyping={typingSignal(realtimeChannel)}
        onSend={async (input) => {
          if (input.videos.length) {
            void sendVideoJobs(where, { jobs: input.videos, body: input.body, mentions: input.mentions, parentMessageId: parentId }, toAuthor(user));
            return input.files.length ? sendMessage(where, { ...input, body: "", parentMessageId: parentId }, toAuthor(user)) : true;
          }
          return sendMessage(where, { ...input, parentMessageId: parentId }, toAuthor(user));
        }} />
    </aside>
  );
}

function useMentionSearch(where: Thread) {
  const channelMembers = useChannelMembers(where.kind === "channel" ? where.id : null).data?.members;
  const everyone = useMembers(where.kind === "channel").data;
  return useCallback((query: string): MentionCandidate[] => {
    const pool = channelMembers?.length ? channelMembers : everyone ?? [];
    const q = query.toLowerCase();
    return pool
      .filter((m) => !q || m.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || m.name.toLowerCase().startsWith(q))
      .map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, sub: m.badge?.label ?? null }));
  }, [channelMembers, everyone]);
}

function useRowActions(where: Thread, user: SessionUser, { inThread = false, onOpenThread, onReply, heySocial = false }: {
  inThread?: boolean;
  onOpenThread?: (message: Message) => void;
  onReply?: (message: Message) => void;
  heySocial?: boolean;
} = {}): RowActions {
  const isStaff = user.role === "owner" || user.role === "team";
  const saved = useHsSidebar(heySocial).data?.savedMessageIds;
  return useMemo(() => ({
    ...(heySocial ? {
      quickEmoji: ["✅", "👀", "🙌"],
      isSaved: (id: string) => Boolean(saved?.includes(id)),
      onSave: (message: Message, value: boolean) => void toggleSaved(message.id, value),
    } : {}),
    meId: user.id,
    isStaff,
    onReact: (message, emoji) => void toggleReaction(where, message, emoji),
    onOpenThread: inThread ? undefined : onOpenThread,
    onReply,
    onEdit: async (message, body) => {
      if (!body.trim()) return false;
      if (body.trim() === message.body.trim()) return true;
      try {
        await editMessage(where, message.id, body);
        return true;
      } catch {
        window.alert("Couldn't save the edit. Try again.");
        return false;
      }
    },
    onDelete: async (message) => {
      if (!window.confirm("Delete this message? This can't be undone.")) return;
      try {
        await deleteMessage(where, message.id);
      } catch {
        window.alert("Couldn't delete the message.");
      }
    },
    onPin: where.kind === "channel" && isStaff ? async (message) => {
      try {
        await api(`/api/messages/${message.id}/pin`, { method: "POST", body: { pinned: !message.pin } });
        void queryClient.invalidateQueries({ queryKey: ["pins", where.id] });
      } catch {
        window.alert("Couldn't change the pin.");
      }
    } : undefined,
    onRetry: async (message) => {
      // Resend as new; the failed copy goes away.
      const files = message.attachments ?? [];
      removeMessage(where, message.id);
      await sendMessage(where, { body: message.body, files, parentMessageId: message.parentMessageId }, message.author);
    },
    onProfile: (userId) => nav.open({ kind: "profile", id: userId }),
    copyLink: async (message) => {
      const { origin } = await ch.info();
      const path = where.kind === "channel" ? `${sitePathFor({ ...nav.get(), view: { kind: "channel", id: where.id } })}&m=${message.id}` : `${sitePathFor({ ...nav.get(), view: { kind: "dm", id: where.id } })}&m=${message.id}`;
      void navigator.clipboard.writeText(`${origin}${path}`);
    },
  }), [where.kind, where.id, user.id, isStaff, inThread, onOpenThread, onReply, heySocial, saved]);
}

function PinsPopover({ channelId, onClose, onJump }: { channelId: string; onClose: () => void; onJump: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pins", channelId],
    queryFn: async () => (await api<{ pins: { messageId: string; body: string; bodyHtml: string | null; createdAt: string; author: { id: string; name: string; avatarUrl: string | null }; pin: { by: { name: string } | null } }[] }>(`/api/channels/${channelId}/pins`)).pins,
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="popover pins" onMouseLeave={onClose}>
      <div className="pop-head"><Pin />Pinned messages</div>
      {isLoading ? <div className="pop-empty">Loading…</div> : null}
      {data?.length === 0 ? <div className="pop-empty">Nothing pinned yet. The team pins what matters most.</div> : null}
      {data?.map((pin) => (
        <button key={pin.messageId} className="pin-row" onClick={() => onJump(pin.messageId)}>
          <Avatar name={pin.author.name} src={pin.author.avatarUrl} seed={pin.author.id} size={26} radius="7px" />
          <span><b>{pin.author.name}</b><RichText html={pin.bodyHtml} text={pin.body} className="rich clamp" /></span>
        </button>
      ))}
    </div>
  );
}

/** A channel or DM: header, messages, composer, and threads beside it. */
export function Conversation({ where, user, workspace, popout = false, threadId: initialThread }: { where: Thread; user: SessionUser; workspace: Workspace; popout?: boolean; threadId?: string }) {
  const heySocial = workspace === "heysocial";
  const hsSidebar = useHsSidebar(heySocial).data;
  const huddles = useHuddles(heySocial).data;
  const channels = useChannels(workspace, where.kind === "channel").data;
  const conversations = useConversations(workspace, where.kind === "dm").data;
  const channel = where.kind === "channel" ? channels?.find((c) => c.id === where.id) : undefined;
  const conversation = where.kind === "dm" ? conversations?.find((c) => c.id === where.id) : undefined;
  const realtimeChannel = where.kind === "channel" ? `channel:${where.id}` : conversation?.realtimeChannel ?? null;
  const [threadId, setThreadId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [pins, setPins] = useState(false);
  const [dragging, setDragging] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const people = useMentionSearch(where);
  const typing = useLiveThread(where, realtimeChannel, user.id);
  const sendTyping = useMemo(() => typingSignal(realtimeChannel), [realtimeChannel]);
  const actions = useRowActions(where, user, {
    // Threads: every channel, and Hey Social Inc. DMs (CreatorHive DMs reply inline instead).
    onOpenThread: where.kind === "channel" || heySocial ? (message) => setThreadId(message.id) : undefined,
    onReply: where.kind === "dm" ? (message) => { setReplyTo(message); composer.current?.focus(); } : undefined,
    heySocial,
  });
  const prefs = heySocial ? (where.kind === "channel" ? hsSidebar?.channels.find((c) => c.id === where.id) : hsSidebar?.dms.find((d) => d.id === where.id)) : undefined;
  const huddle = heySocial ? huddleFor(huddles?.huddles, where.kind, where.id) : undefined;

  // Mark read on open and whenever the window comes back to it.
  useEffect(() => {
    setThreadId(initialThread ?? null);
    setReplyTo(null);
    void markRead(where).then(() => {
      void queryClient.invalidateQueries({ queryKey: where.kind === "channel" ? keys.channels(workspace) : keys.conversations(workspace) });
      ch.app.refreshBadge();
    });
    if (!popout) ch.app.setViewing(where.id);
    const off = ch.window.onFocus((focused) => {
      if (focused) void markRead(where);
    });
    return () => {
      off();
      if (!popout) ch.app.setViewing(null);
    };
  }, [where.kind, where.id, workspace, popout]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && threadId && !document.querySelector(".emoji-pop, .scrim")) setThreadId(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [threadId]);

  const title = where.kind === "channel" ? (channel ? channelName(channel.name) : "") : conversation?.displayName ?? "";
  const other = conversation?.other;

  const head = (
    <div className={`mhead ${popout ? "popout-head" : ""}`}>
      {where.kind === "channel" ? (
        <h1>
          {heySocial && prefs ? <button className={`star ${prefs.starred ? "on" : ""}`} title={prefs.starred ? "Unstar" : "Star"} onClick={() => void setPrefs("channel", where.id, { starred: !prefs.starred })}><Star /></button> : null}
          {channel?.isPrivate && !(channel as { workspaceOpen?: boolean }).workspaceOpen ? <Lock /> : <Hash />}{title}
          {heySocial && prefs ? <button className="mute-btn" title="Mute: only @mentions notify you" onClick={() => void setPrefs("channel", where.id, { muted: !prefs.muted })}>{prefs.muted ? <BellOff /> : <Bell />}{prefs.muted ? "Muted" : ""}</button> : null}
        </h1>
      ) : (
        <h1>
          {conversation ? <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl} seed={conversation.isGroup ? conversation.id : other?.id}
            size={28} radius="8px" presence={conversation.isGroup ? undefined : other?.presence} /> : null}
          {title}
        </h1>
      )}
      {where.kind === "dm" && other && !conversation?.isGroup ? <span className="sub">{other.presence === "online" ? "Active now" : other.presence === "away" ? "Away" : ""}</span> : null}
      {where.kind === "channel" && channel?.description && !popout ? <span className="sub">{channel.description}</span> : null}
      {conversation?.isGroup ? <span className="sub">{conversation.participants.length + 1} people</span> : null}
      <div className="acts">
        {where.kind === "channel" && channel ? <span className="faint member-count" title="Members"><Users />{channel.memberCount}</span> : null}
        {heySocial && huddles?.configured ? <HuddleButton kind={where.kind} id={where.id} label={where.kind === "channel" ? `#${title}` : title} huddle={huddle} meId={user.id} /> : null}
        {where.kind === "channel" ? (
          <span style={{ position: "relative" }}>
            <button className="iconbtn" title="Pinned messages" onClick={() => setPins(!pins)}><Pin /></button>
            {pins ? <PinsPopover channelId={where.id} onClose={() => setPins(false)} onJump={(id) => {
              setPins(false);
              document.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
            }} /> : null}
          </span>
        ) : null}
        {where.kind === "dm" && other && !conversation?.isGroup ? <button className="iconbtn" title="Profile" onClick={() => (popout ? ch.app.openMain(`profile:${other.id}`) : nav.open({ kind: "profile", id: other.id }))}><Info /></button> : null}
        {!popout ? <button className="iconbtn" title="Open in its own window (⌘⇧O)" onClick={() => ch.window.popout({ kind: where.kind, id: where.id, title })}><SquareArrowOutUpRight /></button> : null}
        {popout ? <button className="iconbtn" title="Show in the main window" onClick={() => ch.app.openMain(`${where.kind}:${where.id}`)}><ExternalLink /></button> : null}
      </div>
    </div>
  );

  const intro = where.kind === "channel" ? (
    <div className="convo-intro"><h2>#{title}</h2><p>{channel?.description || "This is the very beginning of the channel."}</p></div>
  ) : (
    <div className="convo-intro">
      {conversation ? <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl} seed={other?.id ?? conversation.id} size={64} radius="16px" /> : null}
      <h2>{title}</h2><p>This is the beginning of your conversation{conversation?.isGroup ? "" : ` with ${title}`}.</p>
    </div>
  );

  return (
    <div className={`convo ${threadId ? "with-thread" : ""}`}
      onDragEnter={(event) => event.dataTransfer.types.includes("Files") && setDragging(true)}>
      <div className="convo-main">
        {head}
        <MessageList where={where} actions={actions} header={intro} empty={null} />
        <div className="typing">{typingLine(typing)}</div>
        {replyTo ? (
          <div className="replying"><span>Replying to <b>{replyTo.author.name}</b>: {replyTo.body.slice(0, 120)}</span><button className="iconbtn" onClick={() => setReplyTo(null)}><X /></button></div>
        ) : null}
        <Composer ref={composer} draftKey={`${where.kind}:${where.id}`}
          uploadVideo={heySocial ? undefined : (file, onProgress) => uploadVideo(where, file, onProgress)}
          voice={where.kind === "dm" || heySocial ? { path: `/api/${where.kind === "channel" ? "channels" : "dms"}/${where.id}/voice`, onSent: (m) => m && addMessage(where, m as Message) } : undefined} uploadFolder={heySocial ? (where.kind === "channel" ? where.id : `dm-${where.id}`) : undefined} placeholder={where.kind === "channel" ? `Message #${title}` : `Message ${title}`}
          searchPeople={where.kind === "channel" ? people : undefined} onTyping={sendTyping}
          onSend={async (input: ComposerSend) => {
            if (input.videos.length) {
              // Goes out now; the message shows the upload and becomes real when it's done.
              void sendVideoJobs(where, { jobs: input.videos, body: input.body, mentions: input.mentions }, toAuthor(user));
              if (!input.files.length) return true;
              input = { ...input, body: "" };
            }
            const ok = await sendMessage(where, { ...input, replyToMessageId: replyTo?.id ?? null }, toAuthor(user));
            if (ok) setReplyTo(null);
            return ok;
          }} />
        {dragging ? (
          <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => event.currentTarget === event.target && setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              composer.current?.addFiles([...event.dataTransfer.files]);
            }}>
            <div><Upload /><b>{heySocial ? "Upload to" : "Drop to share in"} {where.kind === "channel" ? `#${title}` : title}</b><span>{heySocial ? "Any file up to 1 GB, 10 at a time" : "Pictures and documents (PDF, Word, Excel, PowerPoint)"}</span></div>
          </div>
        ) : null}
      </div>
      {threadId ? <ThreadPanel where={where} parentId={threadId} user={user} title={where.kind === "channel" ? `#${title}` : title} onClose={() => setThreadId(null)} realtimeChannel={realtimeChannel} workspace={workspace} /> : null}
    </div>
  );
}
