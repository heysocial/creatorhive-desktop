import type { ReactNode } from "react";
import {
  AtSign, Bell, Bookmark, BookOpen, Calendar, ChartNoAxesCombined, Contact, ExternalLink, GraduationCap, Hash, House,
  Kanban, Lightbulb, Lock, MessageCircle, MessagesSquare, Receipt, Sun, Trophy, Users, type LucideIcon,
} from "lucide-react";
import { ch, type SessionUser } from "../lib/bridge";
import { useChannels, useConversations, type Workspace } from "../lib/api";
import { useNav, type Location } from "../lib/nav";
import { sitePathFor } from "../lib/sitePaths";
import { Avatar, channelName } from "../lib/ui";
import { Conversation } from "./messages/Conversation";
import { Home } from "./home/Home";
import { TodayPage } from "./home/Today";
import { Events } from "./events/Events";
import { Leaderboard } from "./people/Leaderboard";
import { Members } from "./people/Members";
import { ProfilePage } from "./people/Profile";
import { Deals } from "./hub/Deals";
import { Dashboard } from "./hub/Dashboard";
import { Clients } from "./hub/Clients";
import { Invoices } from "./hub/Invoices";
import { DealOverlay } from "./hub/DealPanel";
import { Courses, CoursePage } from "./learn/Courses";
import { ImprovePage } from "./learn/Improve";
import { Resources } from "./learn/Resources";
import { ScriptWriter } from "./learn/ScriptWriter";
import { Activity } from "./activity/Activity";

interface Screen {
  icon: LucideIcon;
  title: ReactNode;
  sub?: string;
  phase: string;
  what: string;
}

const PHASES = {
  community: "Phase 2 · Community",
  hub: "Phase 3 · Creator Hub",
  learn: "Phase 4 · Learn, Activity and Settings",
  heySocial: "Phase 5 · Hey Social Inc.",
};

function useScreen(location: Location): Screen {
  const workspace: Workspace = location.ws === "hs" ? "heysocial" : "creatorhive";
  const channels = useChannels(workspace).data;
  const conversations = useConversations(workspace).data;
  const { view } = location;

  switch (view.kind) {
    case "feed":
      return { icon: House, title: "Home", phase: PHASES.community, what: "The feed with Paid this month at the top, posts by category, and the Today panel." };
    case "today":
      return { icon: Sun, title: "Today", phase: PHASES.community, what: "Your day: today's event, Hub deadlines, people waiting on you and your streak." };
    case "events":
      return { icon: Calendar, title: "Events", phase: PHASES.community, what: "A week calendar with Join Zoom meeting on every event, and Add to Calendar." };
    case "leaderboard":
      return { icon: Trophy, title: "Leaderboard", phase: PHASES.community, what: "This month's prize, the board, and how you earned your points." };
    case "members":
      return { icon: Users, title: "Members", phase: PHASES.community, what: "Everyone in the community, with profiles." };
    case "channel": {
      const channel = channels?.find((c) => c.id === view.id);
      return {
        icon: channel?.isPrivate ? Lock : Hash,
        title: channel ? channelName(channel.name) : "Channel",
        sub: [channel?.description, channel ? `${channel.memberCount} members` : ""].filter(Boolean).join(" · "),
        phase: PHASES.community,
        what: "Messages, threads beside the channel, reactions, files and the composer.",
      };
    }
    case "dm": {
      const conversation = conversations?.find((c) => c.id === view.id);
      const other = conversation?.other;
      return {
        icon: MessageCircle,
        title: conversation ? (
          <>
            <Avatar name={conversation.displayName} src={conversation.isGroup ? null : other?.avatarUrl}
              seed={conversation.isGroup ? conversation.id : other?.id} size={28} radius="8px"
              online={!conversation.isGroup && other?.presence === "online"} />
            {conversation.displayName}
          </>
        ) : "Conversation",
        sub: conversation && !conversation.isGroup ? (other?.presence === "online" ? "Active now" : "") : conversation ? `${conversation.participants.length + 1} people` : "",
        phase: PHASES.community,
        what: "The conversation, voice memos, videos and files, pop-out into its own window, and drag and drop.",
      };
    }
    case "dms-home":
    case "profile":
    case "course":
    case "resource":
    case "script-writer":
      return { icon: MessageCircle, title: "Direct messages", phase: PHASES.community, what: "" };
    case "hub": {
      const pages = {
        deals: { icon: Kanban, title: "Deals", what: "Outreach, Campaigns and Payment boards with drag and drop, and deals in their own window." },
        dashboard: { icon: ChartNoAxesCombined, title: "Dashboard", what: "Collected, Money in play, Potential, the pipeline and breakdowns. Every number opens its deals." },
        clients: { icon: Contact, title: "Past clients", what: "Every brand you've worked with, with contacts, notes and past deals." },
        invoices: { icon: Receipt, title: "Invoices", what: "Every invoice in one list: Draft, Sent and Paid." },
      };
      return { ...pages[view.page], phase: PHASES.hub };
    }
    case "learn": {
      const pages = {
        courses: { icon: GraduationCap, title: "Courses", what: "Your courses, lessons with timestamped notes, and Picture in Picture." },
        improve: { icon: Lightbulb, title: "Improve", what: "The Script Writer and the rest of Improve." },
        resources: { icon: BookOpen, title: "Resources", what: "Your pages and files, with Quick Look." },
      };
      return { ...pages[view.page], phase: PHASES.learn };
    }
    case "activity":
      return { icon: Bell, title: "Activity", phase: PHASES.learn, what: "Mentions, thread replies, reactions and Hub reminders in one inbox." };
    case "threads":
      return { icon: MessagesSquare, title: "Threads", phase: PHASES.heySocial, what: "Every thread you're in, newest reply first." };
    case "mentions":
      return { icon: AtSign, title: "Mentions & reactions", phase: PHASES.heySocial, what: "Everything that mentions or reacts to you." };
    case "saved":
      return { icon: Bookmark, title: "Saved for later", phase: PHASES.heySocial, what: "Messages you saved, with reminders." };
  }
}

/** The screens that are built; everything else still shows its placeholder. */
function Built({ location, user }: { location: Location; user: SessionUser }) {
  const workspace: Workspace = location.ws === "hs" ? "heysocial" : "creatorhive";
  const { view } = location;
  switch (view.kind) {
    case "feed":
      return <Home user={user} openPostId={view.postId ?? null} />;
    case "today":
      return <TodayPage />;
    case "events":
      return <Events eventId={view.eventId} />;
    case "leaderboard":
      return <Leaderboard />;
    case "members":
      return <Members />;
    case "profile":
      return <ProfilePage key={view.id} id={view.id} user={user} />;
    case "channel":
    case "dm":
      return <Conversation key={`${view.kind}:${view.id}`} where={{ kind: view.kind, id: view.id }} user={user} workspace={workspace} />;
    case "hub": {
      const page = view.page === "dashboard" ? <Dashboard /> : view.page === "clients" ? <Clients /> : view.page === "invoices" ? <Invoices /> : <Deals board={view.board} smart={view.smart} />;
      return <>{page}{view.dealId ? <DealOverlay key={view.dealId} id={view.dealId} /> : null}</>;
    }
    case "learn":
      return view.page === "improve" ? <ImprovePage /> : view.page === "resources" ? <Resources /> : <Courses />;
    case "course":
      return <CoursePage key={view.id} id={view.id} lessonId={view.lessonId} />;
    case "resource":
      return <Resources pageId={view.id} />;
    case "script-writer":
      return <ScriptWriter chatId={view.chatId} />;
    case "activity":
      return location.ws === "ch" ? <Activity filter={view.filter} /> : null;
    case "dms-home":
      return <div className="empty-state"><div><MessageCircle style={{ width: 34, height: 34, color: "var(--ink-4)" }} /><p style={{ marginTop: 8 }}>Pick a conversation, or start a new one with ⌘N.</p></div></div>;
    default:
      return null;
  }
}

export function Main({ user }: { user: SessionUser }) {
  const { current } = useNav();
  const built = Built({ location: current, user });
  if (built) return <main className="main">{built}</main>;
  return <Placeholder current={current} />;
}

function Placeholder({ current }: { current: Location }) {
  const screen = useScreen(current);
  const Icon = screen.icon;
  return (
    <main className="main">
      <div className="mhead">
        <h1>{typeof screen.title === "string" ? <><Icon />{screen.title}</> : screen.title}</h1>
        {screen.sub ? <span className="sub">{screen.sub}</span> : null}
        <div className="acts">
          <button className="btn" onClick={() => ch.app.openSite(sitePathFor(current))}>
            <ExternalLink />Open on the website
          </button>
        </div>
      </div>
      <div className="placeholder">
        <div className="inner">
          <div className="ico"><Icon /></div>
          <h2>Coming in {screen.phase}</h2>
          <p>{screen.what}</p>
          <p className="faint" style={{ fontSize: 12.5 }}>Until then, Open on the website shows this page in your browser.</p>
        </div>
      </div>
    </main>
  );
}
