import { useMemo, useState } from "react";
import {
  AtSign, Bell, Bookmark, Calendar, ChartNoAxesCombined, Contact, Download, GraduationCap, Hash, House, Kanban,
  Lightbulb, Lock, MessagesSquare, Receipt, Search, Sun, Trophy, Users, BookOpen,
} from "lucide-react";
import { useChannels, useConversations, type Conversation, type Workspace } from "../lib/api";
import type { SessionUser } from "../lib/bridge";
import { commands } from "../lib/commands";
import { nav, useNav } from "../lib/nav";
import { Avatar, channelName } from "../lib/ui";
import { SidebarHead, SidebarItem, SidebarSection, Skeleton } from "./parts";
import { useTodayCount } from "../views/home/Today";
import { useNextEventDay } from "../views/events/Events";

const byRecent = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");

function dmAvatar(conversation: Conversation, size = 20) {
  const other = conversation.other;
  return (
    <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl}
      seed={conversation.isGroup ? conversation.id : other?.id} size={size} radius="6px"
      online={!conversation.isGroup && other?.presence === "online"} />
  );
}

function ChannelList({ workspace }: { workspace: Workspace }) {
  const { data, isLoading, isError } = useChannels(workspace);
  const channels = useMemo(
    () => (data ?? []).filter((c) => c.joined || !c.isPrivate).sort((a, b) => channelName(a.name).localeCompare(channelName(b.name))),
    [data],
  );
  return (
    <SidebarSection id={`${workspace}-channels`} title="Channels">
      {isLoading ? <Skeleton /> : null}
      {isError ? <div className="sb-empty">Couldn't load channels.</div> : null}
      {!isLoading && !isError && channels.length === 0 ? <div className="sb-empty">No channels yet.</div> : null}
      {channels.map((channel) => (
        <SidebarItem key={channel.id} icon={channel.isPrivate ? <Lock /> : <Hash />} label={channelName(channel.name)}
          view={{ kind: "channel", id: channel.id }} count={channel.mentionCount} unread={channel.unreadCount > 0} />
      ))}
    </SidebarSection>
  );
}

function DmList({ workspace, limit = 12 }: { workspace: Workspace; limit?: number }) {
  const { data, isLoading, isError } = useConversations(workspace);
  const conversations = useMemo(() => [...(data ?? [])].sort(byRecent).slice(0, limit), [data, limit]);
  return (
    <SidebarSection id={`${workspace}-dms`} title="Direct messages">
      {isLoading ? <Skeleton rows={3} /> : null}
      {isError ? <div className="sb-empty">Couldn't load messages.</div> : null}
      {!isLoading && !isError && conversations.length === 0 ? <div className="sb-empty">No conversations yet.</div> : null}
      {conversations.map((conversation) => (
        <SidebarItem key={conversation.id} icon={dmAvatar(conversation)} label={conversation.displayName}
          view={{ kind: "dm", id: conversation.id }} count={conversation.unreadCount} />
      ))}
    </SidebarSection>
  );
}

function CreatorHiveHome() {
  const today = useTodayCount();
  const nextEvent = useNextEventDay();
  return (
    <>
      <SidebarHead title="CreatorHive" action={() => commands.run("new-message")} />
      <div className="sb-scroll">
        <SidebarItem icon={<House />} label="Home" view={{ kind: "feed" }} />
        <SidebarItem icon={<Sun />} label="Today" view={{ kind: "today" }} quietCount={today} honeyCount />
        <SidebarItem icon={<Calendar />} label="Events" view={{ kind: "events" }} meta={nextEvent} />
        <SidebarItem icon={<Trophy />} label="Leaderboard" view={{ kind: "leaderboard" }} />
        <SidebarItem icon={<Users />} label="Members" view={{ kind: "members" }} />
        <ChannelList workspace="creatorhive" />
        <DmList workspace="creatorhive" />
      </div>
    </>
  );
}

function HeySocialHome() {
  return (
    <>
      <SidebarHead title="Hey Social Inc." action={() => commands.run("new-message")} />
      <div className="sb-scroll">
        <SidebarItem icon={<MessagesSquare />} label="Threads" view={{ kind: "threads" }} />
        <SidebarItem icon={<AtSign />} label="Mentions & reactions" view={{ kind: "mentions" }} />
        <SidebarItem icon={<Bookmark />} label="Saved for later" view={{ kind: "saved" }} />
        <ChannelList workspace="heysocial" />
        <DmList workspace="heysocial" />
      </div>
    </>
  );
}

/** The DMs view from the rail: every conversation with a preview, newest first. */
function DirectMessages({ workspace, user }: { workspace: Workspace; user: SessionUser }) {
  const { data, isLoading, isError } = useConversations(workspace);
  const [filter, setFilter] = useState("");
  const { current } = useNav();
  const conversations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...(data ?? [])].sort(byRecent).filter((c) => !q || c.displayName.toLowerCase().includes(q));
  }, [data, filter]);

  return (
    <>
      <SidebarHead title="Direct messages" action={() => commands.run("new-message")} />
      <label className="search-trigger" style={{ position: "static", transform: "none", width: "auto", margin: "0 4px 8px", height: 28, flex: "none" }}>
        <Search />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a DM"
          style={{ border: 0, background: "none", outline: "none", flex: 1, fontSize: 13 }} />
      </label>
      <div className="sb-scroll">
        {isLoading ? <Skeleton rows={6} /> : null}
        {isError ? <div className="sb-empty">Couldn't load messages.</div> : null}
        {conversations.map((conversation) => {
          const on = current.view.kind === "dm" && current.view.id === conversation.id;
          const mine = conversation.lastMessageAuthorId === user.id;
          const preview = conversation.lastMessagePreview ? `${mine ? "You: " : ""}${conversation.lastMessagePreview}` : "";
          return (
            <button key={conversation.id} className={`sb-item ${on ? "on" : conversation.unreadCount ? "unread" : ""}`}
              style={{ minHeight: 52 }} data-nav={JSON.stringify({ kind: "dm", id: conversation.id })}
              data-unread={conversation.unreadCount ? "1" : undefined}
              onClick={() => nav.open({ kind: "dm", id: conversation.id })}>
              {dmAvatar(conversation, 34)}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 6 }}>
                  <span className="label" style={{ fontSize: 13.5 }}>{conversation.displayName}</span>
                  <span className="faint" style={{ fontSize: 11, fontWeight: 400 }}>{shortTime(conversation.lastMessageAt)}</span>
                </span>
                <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", fontWeight: conversation.unreadCount ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {preview}
                </span>
              </span>
              {conversation.unreadCount ? <span className="cnt">{conversation.unreadCount}</span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function shortTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Hub() {
  return (
    <>
      <SidebarHead title="Creator Hub" actionLabel="New deal" />
      <div className="sb-scroll">
        <SidebarItem icon={<Kanban />} label="Deals" view={{ kind: "hub", page: "deals" }} />
        <SidebarItem icon={<ChartNoAxesCombined />} label="Dashboard" view={{ kind: "hub", page: "dashboard" }} />
        <SidebarItem icon={<Contact />} label="Past clients" view={{ kind: "hub", page: "clients" }} />
        <SidebarItem icon={<Receipt />} label="Invoices" view={{ kind: "hub", page: "invoices" }} />
        <button className="sb-item" onClick={() => window.ch.app.openSite("/hub")}><Download />Export…</button>
      </div>
    </>
  );
}

function Learn() {
  return (
    <>
      <SidebarHead title="Learn" />
      <div className="sb-scroll">
        <SidebarItem icon={<GraduationCap />} label="Courses" view={{ kind: "learn", page: "courses" }} />
        <SidebarItem icon={<Lightbulb />} label="Improve" view={{ kind: "learn", page: "improve" }} />
        <SidebarItem icon={<BookOpen />} label="Resources" view={{ kind: "learn", page: "resources" }} />
      </div>
    </>
  );
}

function Activity({ title }: { title: string }) {
  return (
    <>
      <SidebarHead title={title} />
      <div className="sb-scroll">
        <SidebarItem icon={<Bell />} label="All activity" view={{ kind: "activity" }} />
      </div>
    </>
  );
}

function Later() {
  return (
    <>
      <SidebarHead title="Later" />
      <div className="sb-scroll">
        <SidebarItem icon={<Bookmark />} label="Saved for later" view={{ kind: "saved" }} />
      </div>
    </>
  );
}

export function Sidebar({ user }: { user: SessionUser }) {
  const { current } = useNav();
  const workspace: Workspace = current.ws === "hs" ? "heysocial" : "creatorhive";
  let content;
  switch (current.section) {
    case "dms":
      content = <DirectMessages workspace={workspace} user={user} />;
      break;
    case "hub":
      content = <Hub />;
      break;
    case "learn":
      content = <Learn />;
      break;
    case "activity":
      content = <Activity title="Activity" />;
      break;
    case "later":
      content = <Later />;
      break;
    default:
      content = current.ws === "hs" ? <HeySocialHome /> : <CreatorHiveHome />;
  }
  return <aside className="sidebar" aria-label="Sidebar">{content}</aside>;
}
