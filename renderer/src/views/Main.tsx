import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { ch, type SessionUser } from "../lib/bridge";
import { ErrorBoundary, screenFor } from "../lib/errors";
import { type Workspace } from "../lib/api";
import { useNav, type Location } from "../lib/nav";
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
import { ImproveResource } from "./learn/ImproveResource";
import { Activity } from "./activity/Activity";
import { HsMentions, HsSaved, HsThreads } from "./heysocial/Lists";
import { HsPeople } from "./heysocial/People";
import { Admin } from "./admin/Admin";

/** The screen for a place in the app. */
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
      return <Members user={user} />;
    case "profile":
      return <ProfilePage key={view.id} id={view.id} user={user} />;
    case "channel":
    case "dm":
      return <Conversation key={`${view.kind}:${view.id}`} where={{ kind: view.kind, id: view.id }} user={user} workspace={workspace} threadId={view.threadId} messageId={view.messageId} />;
    case "threads":
      return <HsThreads />;
    case "mentions":
      return <HsMentions />;
    case "saved":
      return <HsSaved />;
    case "hs-people":
      return <HsPeople />;
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
    case "improve-resource":
      return <ImproveResource key={view.slug} slug={view.slug} />;
    case "activity":
      return location.ws === "ch" ? <Activity filter={view.filter} /> : <HsMentions />;
    case "admin":
      return <Admin page={view.page} id={view.id} />;
    case "dms-home":
      return <div className="empty-state"><div><MessageCircle style={{ width: 34, height: 34, color: "var(--ink-4)" }} /><p style={{ marginTop: 8 }}>Pick a conversation, or start a new one with ⌘N.</p></div></div>;
    default:
      return null;
  }
}

export function Main({ user }: { user: SessionUser }) {
  const { current } = useNav();
  const screen = screenFor(current);
  useEffect(() => ch.errors?.setScreen(screen), [screen]);
  const built = Built({ location: current, user });
  // A screen that throws is reported and offers Try again; the rest of the window keeps working.
  if (built) return <main className="main"><ErrorBoundary resetKey={JSON.stringify(current)}>{built}</ErrorBoundary></main>;
  return <main className="main"><div className="empty-state"><p>Nothing to show here.</p></div></main>;
}
