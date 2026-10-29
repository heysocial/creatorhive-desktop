import { useMemo, useState } from "react";
import {
  Calendar, ChartNoAxesCombined, Contact, Download, GraduationCap, Hash, House, Kanban,
  Lightbulb, Lock, Receipt, Search, Sun, Trophy, Users, BookOpen,
} from "lucide-react";
import { useChannels, useConversations, type Conversation, type Workspace } from "../lib/api";
import type { SessionUser } from "../lib/bridge";
import { commands } from "../lib/commands";
import { nav, useNav } from "../lib/nav";
import { Avatar, channelName } from "../lib/ui";
import { ActivityRows, SidebarHead, SidebarItem, SidebarSection, Skeleton } from "./parts";
import { useTodayCount } from "../views/home/Today";
import { useNextEventDay } from "../views/events/Events";
import { BOARDS, BOARD_LABELS, active, allDeals, total, useDeals } from "../lib/hub";
import { smartDeals } from "../views/hub/Deals";
import { openDealForm } from "../views/hub/DealForm";
import { openExport } from "../views/hub/Export";
import { money } from "../lib/format";
import { Clock3, Hourglass, Repeat, PlayCircle, Sparkles as Spark, FileText } from "lucide-react";
import { percent, useCourses, useImprove, useImproveResources } from "../lib/learn";
import { useResourcePages, useResourcesAccess } from "../views/learn/Resources";
import { HeySocialSidebar } from "./HeySocialSidebar";
import { AdminSidebar } from "./AdminSidebar";

const byRecent = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");

function dmAvatar(conversation: Conversation, size = 20) {
  const other = conversation.other;
  return (
    <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl}
      seed={conversation.isGroup ? conversation.id : other?.id} size={size} radius="6px"
      presence={conversation.isGroup ? undefined : other?.presence} />
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
      <ActivityRows />
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
      {workspace === "creatorhive" ? <ActivityRows /> : null}
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
  const data = useDeals().data;
  const deals = allDeals(data);
  const awaiting = smartDeals("awaiting", deals);
  return (
    <>
      <SidebarHead title="Creator Hub" actionLabel="New deal (⌥⌘N)" action={() => openDealForm({})} />
      <ActivityRows />
      <div className="sb-scroll">
        <SidebarItem icon={<Kanban />} label="Deals" view={{ kind: "hub", page: "deals" }} meta={data ? String(active(deals).length) : undefined} />
        <SidebarItem icon={<ChartNoAxesCombined />} label="Dashboard" view={{ kind: "hub", page: "dashboard" }} />
        <SidebarItem icon={<Contact />} label="Past clients" view={{ kind: "hub", page: "clients" }} />
        <SidebarItem icon={<Receipt />} label="Invoices" view={{ kind: "hub", page: "invoices" }} />
        <button className="sb-item" onClick={() => openExport()}><Download /><span className="label">Export…</span><span className="meta">⇧⌘E</span></button>
        <SidebarSection id="hub-boards" title="Boards">
          {BOARDS.map((b) => <SidebarItem key={b} icon={<span className={`board-dot b-${b}`} />} label={BOARD_LABELS[b]} view={{ kind: "hub", page: "deals", board: b }} meta={data ? String(active(data[b]).length) : undefined} />)}
        </SidebarSection>
        <SidebarSection id="hub-smart" title="Smart views">
          <SidebarItem icon={<Clock3 />} label="Due this week" view={{ kind: "hub", page: "deals", smart: "due" }} meta={data ? String(smartDeals("due", deals).length) : undefined} />
          <SidebarItem icon={<Hourglass />} label="Awaiting payment" view={{ kind: "hub", page: "deals", smart: "awaiting" }} meta={data ? money(total(awaiting)) : undefined} />
          <SidebarItem icon={<Repeat />} label="Retainers" view={{ kind: "hub", page: "deals", smart: "retainers" }} meta={data ? String(smartDeals("retainers", deals).length) : undefined} />
        </SidebarSection>
        {data?.shared ? (
          <SidebarSection id="hub-shared" title="Shared Hub">
            {data.members.map((m) => <div key={m.id} className="sb-item static"><span className="mini-av">{m.initials}</span><span className="label">{m.name}</span></div>)}
          </SidebarSection>
        ) : null}
      </div>
    </>
  );
}

function Learn() {
  const courses = useCourses().data ?? [];
  const grade = useImprove().data?.grade.overallPercentage;
  const access = useResourcesAccess().data;
  const mine = useResourcePages(access === true).data ?? [];
  const guides = useImproveResources().data ?? [];
  const inProgress = courses.filter((c) => c.completedCount > 0 && c.completedCount < c.lessonCount);
  return (
    <>
      <SidebarHead title="Learn" />
      <ActivityRows />
      <div className="sb-scroll">
        <SidebarItem icon={<GraduationCap />} label="Courses" view={{ kind: "learn", page: "courses" }} meta={courses.length ? String(courses.length) : undefined} />
        <SidebarItem icon={<Lightbulb />} label="Improve" view={{ kind: "learn", page: "improve" }} meta={grade !== undefined ? `${grade}%` : undefined} />
        <SidebarItem icon={<BookOpen />} label="Resources" view={{ kind: "learn", page: "resources" }} />
        <SidebarItem icon={<Spark />} label="AI Script Writer" view={{ kind: "script-writer" }} meta="Flagship" />
        {inProgress.length ? (
          <SidebarSection id="learn-progress" title="In progress">
            {inProgress.map((c) => <SidebarItem key={c.id} icon={<PlayCircle />} label={c.title} view={{ kind: "course", id: c.id }} meta={`${percent(c)}%`} />)}
          </SidebarSection>
        ) : null}
        {access && mine.length ? (
          <SidebarSection id="learn-pages" title="Your pages">
            {mine.filter((p) => !p.parentId).slice(0, 12).map((p) => <SidebarItem key={p.id} icon={<span className="emoji-ico">{p.icon ?? "📄"}</span>} label={p.title || "Untitled"} view={{ kind: "resource", id: p.id }} />)}
          </SidebarSection>
        ) : null}
        {access === false && guides.length ? (
          <SidebarSection id="learn-guides" title="CreatorHive guides">
            {/* AI Script Writer already has its own item above. */}
            {guides.filter((g) => g.slug !== "ai-script-writer").map((g) => <SidebarItem key={g.id} icon={<FileText />} label={g.title} view={{ kind: "improve-resource", slug: g.slug }} />)}
          </SidebarSection>
        ) : null}
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
      content = <HeySocialSidebar />;
      break;
    case "later":
      content = <HeySocialSidebar />;
      break;
    case "admin":
      content = <AdminSidebar />;
      break;
    default:
      content = current.ws === "hs" ? <HeySocialSidebar /> : <CreatorHiveHome />;
  }
  return <aside className="sidebar" aria-label="Sidebar">{content}</aside>;
}
