import { useEffect } from "react";
import { AtSign, Bell, CheckCheck, Heart, Megaphone, MessageCircle, MessagesSquare } from "lucide-react";
import { queryClient } from "../../lib/api";
import {
  ACTIVITY_KEY, markAllActivityRead, openActivityItem, openActivityThread, useActivity, useActivityThreads,
  type ActivityFilter, type ActivityItem, type ActivityThread,
} from "../../lib/activity";
import { shortTime } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";

/*
  CreatorHive's Activity, as Slack has it: one list of everything aimed at me
  (mentions — old threads included —, replies in my threads, reactions,
  comments), newest first, and a Threads view of every thread I'm in. The
  server keeps both and their read state, shared with the website and iPhone.
*/

const FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mentions", label: "Mentions" },
  { key: "threads", label: "Threads" },
  { key: "reactions", label: "Reactions" },
];

const EMPTY: Record<ActivityFilter, string> = {
  all: "You're all caught up. Mentions, replies and reactions show here.",
  mentions: "No mentions yet. When someone @mentions you, it shows here.",
  threads: "No thread replies yet.",
  reactions: "No reactions yet.",
};

/** The sidebar's own form of each view, so its row stays selected. */
const listView = (filter: ActivityFilter) => (filter === "all" ? { kind: "activity" as const } : { kind: "activity" as const, filter });

const replies = (n: number) => (n === 1 ? "1 new reply" : `${n} new replies`);

function KindIcon({ item }: { item: ActivityItem }) {
  if (item.emoji) return <span className="act-kind emoji">{item.emoji}</span>;
  const icon = item.kind === "mention" ? <AtSign /> : item.kind === "thread" ? <MessagesSquare /> : item.kind === "reaction" ? <Heart />
    : item.type === "announcement" ? <Megaphone /> : <MessageCircle />;
  return <span className={`act-kind k-${item.kind}`}>{icon}</span>;
}

function ItemRow({ item }: { item: ActivityItem }) {
  return (
    <button className={`act-row ${item.unread ? "unread" : ""}`} data-key={item.key} onClick={() => openActivityItem(item)}>
      <span className="act-av">
        {item.actor ? <Avatar name={item.actor.name} src={item.actor.avatarUrl} seed={item.actor.id} size={36} radius="9px" />
          : <span className="t-ico"><Bell /></span>}
        <KindIcon item={item} />
      </span>
      <span className="act-text">
        <span className="act-title">{item.title}</span>
        {item.preview ? <span className="act-quote">{item.preview}</span> : null}
        <span className="act-meta">
          <span>{item.place}</span>
          {item.unread && item.newReplies ? <b className="act-new">{replies(item.newReplies)}</b> : null}
        </span>
      </span>
      <span className="act-when faint">{shortTime(item.at)}</span>
      <i className={`act-dot ${item.unread ? "" : "off"}`} />
    </button>
  );
}

function ThreadRow({ thread }: { thread: ActivityThread }) {
  return (
    <button className={`act-row thread-row ${thread.unread ? "unread" : ""}`} data-thread={thread.parentId} onClick={() => openActivityThread(thread)}>
      <span className="act-av"><Avatar name={thread.author.name} src={thread.author.avatarUrl} seed={thread.author.id} size={36} radius="9px" /></span>
      <span className="act-text">
        <span className="act-meta place">{thread.place}</span>
        <span className="act-line"><b>{thread.author.name}</b> <span className="act-quote">{thread.preview}</span></span>
        {thread.lastReply ? (
          <span className="act-line reply">
            <Avatar name={thread.lastReply.author.name} src={thread.lastReply.author.avatarUrl} seed={thread.lastReply.author.id} size={18} radius="5px" />
            <b>{thread.lastReply.author.name}</b> <span className="act-quote">{thread.lastReply.preview}</span>
          </span>
        ) : null}
        <span className="act-meta">
          {thread.unread && thread.newReplies ? <b className="act-new">{replies(thread.newReplies)}</b> : null}
          <span>{thread.replyCount === 1 ? "1 reply" : `${thread.replyCount} replies`}</span>
        </span>
      </span>
      <span className="act-when faint">{shortTime(thread.lastReply?.at ?? thread.createdAt)}</span>
      <i className={`act-dot ${thread.unread ? "" : "off"}`} />
    </button>
  );
}

function ActivityList({ filter }: { filter: ActivityFilter }) {
  const { data, isLoading, isError, refetch } = useActivity(filter);
  if (isError) return <div className="empty-state"><div className="err-state">Couldn't load Activity.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div>;
  if (isLoading) return <div className="empty-state">Loading…</div>;
  if (!data?.items.length) return <div className="empty-state">{EMPTY[filter]}</div>;
  return <>{data.items.map((item) => <ItemRow key={item.key} item={item} />)}</>;
}

function ThreadList() {
  const { data, isLoading, isError, refetch } = useActivityThreads();
  if (isError) return <div className="empty-state"><div className="err-state">Couldn't load threads.<button className="btn" onClick={() => void refetch()}>Try again</button></div></div>;
  if (isLoading) return <div className="empty-state">Loading…</div>;
  if (!data?.length) return <div className="empty-state">Threads you start or reply in show here.</div>;
  return <>{data.map((thread) => <ThreadRow key={thread.parentId} thread={thread} />)}</>;
}

export function Activity({ tab = "activity", filter = "all" }: { tab?: "activity" | "threads"; filter?: ActivityFilter }) {
  const all = useActivity("all");
  const threads = useActivityThreads();
  const unreadThreads = (threads.data ?? []).filter((t) => t.unread).length;

  // Seeing it refreshes it.
  useEffect(() => { void queryClient.invalidateQueries({ queryKey: ACTIVITY_KEY }); }, [tab, filter]);

  return (
    <div className="page activity-page">
      <div className="mhead">
        <h1>{tab === "threads" ? "Threads" : "Activity"}</h1>
        <div className="seg">
          <button className={tab === "activity" ? "on" : ""} onClick={() => nav.open(listView(filter))}>
            Activity{all.data?.unread ? <span className="seg-count">{all.data.unread}</span> : null}
          </button>
          <button className={tab === "threads" ? "on" : ""} onClick={() => nav.open({ kind: "activity", tab: "threads" })}>
            Threads{unreadThreads ? <span className="seg-count">{unreadThreads}</span> : null}
          </button>
        </div>
        <div className="acts">
          {tab === "activity" ? <button className="btn" disabled={!all.data?.unread} onClick={() => void markAllActivityRead().catch(() => window.alert("Couldn't mark everything as read. Try again."))}><CheckCheck />Mark all as read</button> : null}
        </div>
      </div>
      {tab === "activity" ? (
        <div className="act-filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => nav.open(listView(f.key))}>{f.label}</button>
          ))}
        </div>
      ) : null}
      <div className="scroll activity-list">
        {tab === "threads" ? <ThreadList /> : <ActivityList filter={filter} />}
      </div>
    </div>
  );
}
