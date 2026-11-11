import { useMemo, useState } from "react";
import { contactLabel, useHubHidden, useStarterContacts, type StarterContact } from "../lib/access";
import {
  Calendar, ChartNoAxesCombined, Contact, Download, GraduationCap, Hash, House, Kanban,
  Lightbulb, Lock, Receipt, Search, Sun, Trophy, Users, BookOpen,
} from "lucide-react";
import { api, keys, queryClient, useChannels, useConversations, type Conversation, type Workspace } from "../lib/api";
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
import { SoonTag, soonLast } from "../views/messages/ComingSoon";
import { Clapperboard, Clock as ClockIcon, Eye, MessageCircle as Unread } from "lucide-react";
import { EDIT_STAGE_LABELS, STAGE_CLASS, stageIndex, useStudentEditing, useVideoEditsBoard, type BoardCard } from "../lib/videoEdits";
import { filterCards } from "../views/edits/VideoEdits";
import { StudentLabel } from "../views/edits/StudentStrip";

const byRecent = (a: Conversation, b: Conversation) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");

function dmAvatar(conversation: Conversation, size = 20) {
  const other = conversation.other;
  return (
    <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl}
      seed={conversation.isGroup ? conversation.id : other?.id} size={size} radius="6px"
      presence={conversation.isGroup ? undefined : other?.presence} />
  );
}

/**
 * A limited plan's contacts, pinned above its DMs even before the first message
 * (the website and the phone apps do the same). Clicking opens the conversation,
 * starting it the first time. Their conversations are left out of the list below.
 */
function PinnedContacts({ contacts, conversations }: { contacts: StarterContact[]; conversations: Conversation[] }) {
  const { current } = useNav();
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(contact: StarterContact) {
    const existing = conversations.find((c) => !c.isGroup && c.other?.id === contact.id);
    if (existing) { nav.open({ kind: "dm", id: existing.id }); return; }
    if (starting) return;
    setStarting(contact.id);
    setError(null);
    try {
      const { conversation } = await api<{ conversation: Conversation }>("/api/dms", { method: "POST", body: { userId: contact.id, workspace: "creatorhive" } });
      await queryClient.invalidateQueries({ queryKey: keys.conversations("creatorhive") });
      nav.open({ kind: "dm", id: conversation.id });
    } catch {
      setError("Couldn't start the conversation. Try again.");
    } finally {
      setStarting(null);
    }
  }
  return (
    <SidebarSection id="creatorhive-pinned" title="Pinned">
      {contacts.map((contact) => {
        const existing = conversations.find((c) => !c.isGroup && c.other?.id === contact.id);
        const on = Boolean(existing && current.view.kind === "dm" && current.view.id === existing.id);
        return (
          <button key={contact.id} className={`sb-item ${on ? "on" : existing?.unreadCount ? "unread" : ""}`}
            disabled={starting === contact.id} onClick={() => void open(contact)} title={`Message ${contactLabel(contact)}`}>
            <Avatar name={contact.name} src={contact.avatarUrl} seed={contact.id} size={20} radius="6px" presence={existing?.other?.presence} />
            <span className="label">{starting === contact.id ? "Opening…" : contactLabel(contact)}</span>
            {existing?.unreadCount ? <span className="cnt">{existing.unreadCount}</span> : null}
          </button>
        );
      })}
      {error ? <div className="sb-empty">{error}</div> : null}
    </SidebarSection>
  );
}

const pinnedIds = (contacts: StarterContact[], conversations: Conversation[]) => new Set(conversations
  .filter((c) => !c.isGroup && contacts.some((contact) => contact.id === c.other?.id))
  .map((c) => c.id));

function ChannelList({ workspace }: { workspace: Workspace }) {
  const { data, isLoading, isError } = useChannels(workspace);
  const channels = useMemo(
    () => soonLast((data ?? []).filter((c) => c.joined || !c.isPrivate).sort((a, b) => channelName(a.name).localeCompare(channelName(b.name))), (c) => c, data),
    [data],
  );
  return (
    <SidebarSection id={`${workspace}-channels`} title="Channels">
      {isLoading ? <Skeleton /> : null}
      {isError ? <div className="sb-empty">Couldn't load channels.</div> : null}
      {!isLoading && !isError && channels.length === 0 ? <div className="sb-empty">No channels yet.</div> : null}
      {channels.map((channel) => (
        <SidebarItem key={channel.id} icon={channel.isPrivate && !channel.comingSoon ? <Lock /> : <Hash />} label={channelName(channel.name)}
          tag={channel.comingSoon ? <SoonTag /> : undefined} view={{ kind: "channel", id: channel.id }}
          count={channel.comingSoonLocked ? 0 : channel.mentionCount} unread={!channel.comingSoonLocked && channel.unreadCount > 0} />
      ))}
    </SidebarSection>
  );
}

function DmList({ workspace, limit = 12 }: { workspace: Workspace; limit?: number }) {
  const { data, isLoading, isError } = useConversations(workspace);
  const allContacts = useStarterContacts();
  const contacts = workspace === "creatorhive" ? allContacts : [];
  const conversations = useMemo(() => {
    const pinned = pinnedIds(contacts, data ?? []);
    return [...(data ?? [])].filter((c) => !pinned.has(c.id)).sort(byRecent).slice(0, limit);
  }, [data, limit, contacts]);
  return (
    <>
    {contacts.length > 0 ? <PinnedContacts contacts={contacts} conversations={data ?? []} /> : null}
    <SidebarSection id={`${workspace}-dms`} title="Direct messages">
      {isLoading ? <Skeleton rows={3} /> : null}
      {isError ? <div className="sb-empty">Couldn't load messages.</div> : null}
      {!isLoading && !isError && conversations.length === 0 ? <div className="sb-empty">No conversations yet.</div> : null}
      {conversations.map((conversation) => (
        <SidebarItem key={conversation.id} icon={dmAvatar(conversation)} label={conversation.displayName}
          tag={workspace === "creatorhive" && !conversation.isGroup ? <StudentLabel memberId={conversation.other?.id} /> : undefined}
          view={{ kind: "dm", id: conversation.id }} count={conversation.unreadCount} />
      ))}
    </SidebarSection>
    </>
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
  const allContacts = useStarterContacts();
  const contacts = workspace === "creatorhive" ? allContacts : [];
  // Staff: students with videos to edit get a label, and a chip to show only them.
  const board = useVideoEditsBoard(workspace === "creatorhive").data;
  const cardFor = useMemo(() => {
    const byMember = new Map((board?.cards ?? []).map((c) => [c.member.id, c] as const));
    return (conversation: Conversation): BoardCard | null => (conversation.isGroup ? null : byMember.get(conversation.other?.id) ?? null);
  }, [board]);
  const [studentsOnly, setStudentsOnly] = useState(false);
  const conversations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const pinned = pinnedIds(contacts, data ?? []);
    return [...(data ?? [])].filter((c) => !pinned.has(c.id)).sort(byRecent).filter((c) => !q || c.displayName.toLowerCase().includes(q))
      .filter((c) => !studentsOnly || cardFor(c));
  }, [data, filter, contacts, studentsOnly, cardFor]);
  const studentCount = (data ?? []).filter((c) => cardFor(c)).length;

  return (
    <>
      <SidebarHead title="Direct messages" action={() => commands.run("new-message")} />
      {workspace === "creatorhive" ? <ActivityRows /> : null}
      <label className="search-trigger" style={{ position: "static", transform: "none", width: "auto", margin: "0 4px 8px", height: 28, flex: "none" }}>
        <Search />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a DM"
          style={{ border: 0, background: "none", outline: "none", flex: 1, fontSize: 13 }} />
      </label>
      {workspace === "creatorhive" && board && studentCount > 0 ? (
        <div className="ve-dm-chips" role="tablist">
          <button role="tab" aria-selected={!studentsOnly} className={!studentsOnly ? "on" : ""} onClick={() => setStudentsOnly(false)}>All</button>
          <button role="tab" aria-selected={studentsOnly} className={studentsOnly ? "on" : ""} onClick={() => setStudentsOnly(true)}><Clapperboard />Video edits · {studentCount}</button>
        </div>
      ) : null}
      <div className="sb-scroll">
        {contacts.length > 0 && !filter.trim() ? <PinnedContacts contacts={contacts} conversations={data ?? []} /> : null}
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
                  {cardFor(conversation) ? <><StudentLabel card={cardFor(conversation)} />{" "}</> : null}{preview}
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
  const improve = useImprove().data;
  // UGC Starter's grade is the track's letter; everyone else's is the percentage.
  // The Weekend Starter has no grade (as on the website).
  const grade = improve?.starter ? (improve.starter.overallGrade === "–" || improve.starter.plan === "first3" ? undefined : improve.starter.overallGrade) : improve?.grade.overallPercentage;
  const access = useResourcesAccess().data;
  const mine = useResourcePages(access === true).data ?? [];
  const guides = useImproveResources().data ?? [];
  const inProgress = courses.filter((c) => c.completedCount > 0 && c.completedCount < c.lessonCount);
  // The personal video editor: once her edits are ready, the review screen has its own row.
  const editing = useStudentEditing(Boolean(improve?.starter)).editing;
  const reviewOpen = Boolean(editing?.stage && stageIndex(editing.stage) >= stageIndex("ready_to_review"));
  return (
    <>
      <SidebarHead title="Learn" />
      <ActivityRows />
      <div className="sb-scroll">
        <SidebarItem icon={<GraduationCap />} label="Courses" view={{ kind: "learn", page: "courses" }} meta={courses.length ? String(courses.length) : undefined} />
        <SidebarItem icon={<Lightbulb />} label="Improve" view={{ kind: "learn", page: "improve" }} meta={grade === undefined ? undefined : typeof grade === "number" ? `${grade}%` : `Grade ${grade}`} />
        {reviewOpen ? <SidebarItem icon={<Eye />} label="Review your videos" view={{ kind: "video-review" }} meta={editing?.stage ? EDIT_STAGE_LABELS[editing.stage] : undefined} /> : null}
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

/** Staff: the video editing board's filters and every student on it. */
function VideoEditing() {
  const board = useVideoEditsBoard().data;
  const cards = board?.cards ?? [];
  const order = (c: BoardCard) => stageIndex(c.stage) * 1e9 + (c.dueOn ? Date.parse(c.dueOn) / 1e5 : 9e8);
  return (
    <>
      <SidebarHead title="Video editing" />
      <ActivityRows />
      <div className="sb-scroll">
        <SidebarItem icon={<Clapperboard />} label="Board" view={{ kind: "video-edits" }} meta={board ? String(cards.length) : undefined} />
        <SidebarItem icon={<ClockIcon />} label="Due in 2 days" view={{ kind: "video-edits", filter: "due" }} meta={board ? String(filterCards(cards, "due").length) : undefined} />
        <SidebarItem icon={<Unread />} label="Unread messages" view={{ kind: "video-edits", filter: "unread" }} count={filterCards(cards, "unread").length} />
        {cards.length ? (
          <SidebarSection id="edits-students" title="Students">
            {[...cards].sort((a, b) => order(a) - order(b)).map((card) => (
              <SidebarItem key={card.id} icon={<Avatar name={card.member.name} src={card.member.avatarUrl} seed={card.member.id} size={20} radius="6px" />}
                label={card.member.name} view={{ kind: "video-edits", cardId: card.id }}
                tag={<span className={`stage-pill sm ${STAGE_CLASS[card.stage]}`}>{EDIT_STAGE_LABELS[card.stage]}</span>} count={card.unread} />
            ))}
          </SidebarSection>
        ) : null}
      </div>
    </>
  );
}

export function Sidebar({ user }: { user: SessionUser }) {
  const { current } = useNav();
  const hubHidden = useHubHidden();
  const workspace: Workspace = current.ws === "hs" ? "heysocial" : "creatorhive";
  let content;
  switch (current.section) {
    case "dms":
      content = <DirectMessages workspace={workspace} user={user} />;
      break;
    case "hub":
      content = hubHidden ? null : <Hub />;
      break;
    case "learn":
      content = <Learn />;
      break;
    case "edits":
      content = <VideoEditing />;
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
