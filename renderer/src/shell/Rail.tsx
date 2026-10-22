import { Bell, Bookmark, GraduationCap, House, MessageCircle, Sparkles, type LucideIcon } from "lucide-react";
import { ch, type SessionUser } from "../lib/bridge";
import { useChannels, useConversations, useHeySocialAccess } from "../lib/api";
import { commands } from "../lib/commands";
import { nav, useNav, type Section, SECTIONS } from "../lib/nav";
import { Avatar, countLabel } from "../lib/ui";
import { useActivityRows } from "../views/activity/Activity";
import { useHsSidebar } from "../lib/heysocial";

const SECTION_META: Record<Section, { label: string; icon: LucideIcon; shortcut: string }> = {
  home: { label: "Home", icon: House, shortcut: "⌘1" },
  dms: { label: "DMs", icon: MessageCircle, shortcut: "⌘2" },
  hub: { label: "Hub", icon: Sparkles, shortcut: "⌘3" },
  learn: { label: "Learn", icon: GraduationCap, shortcut: "⌘4" },
  activity: { label: "Activity", icon: Bell, shortcut: "⌘5" },
  later: { label: "Later", icon: Bookmark, shortcut: "" },
};

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

/** Unread for a workspace: DMs with something new, plus channel @mentions. */
function useWorkspaceUnread(workspace: "creatorhive" | "heysocial", enabled: boolean) {
  const conversations = useConversations(workspace, enabled).data ?? [];
  const channels = useChannels(workspace, enabled).data ?? [];
  const dms = sum(conversations.map((c) => c.unreadCount ?? 0));
  const mentions = sum(channels.map((c) => c.mentionCount ?? 0));
  return { dms, total: dms + mentions };
}

export function Rail({ user }: { user: SessionUser }) {
  const { current } = useNav();
  const heySocial = useHeySocialAccess().data === true;
  const chUnread = useWorkspaceUnread("creatorhive", true);
  const hsUnread = useWorkspaceUnread("heysocial", heySocial);
  const here = current.ws === "hs" ? hsUnread : chUnread;
  const other = current.ws === "hs" ? chUnread : hsUnread;
  const activity = useActivityRows().filter((r) => r.unread && r.kind !== "dm").length;
  const hsCounts = useHsSidebar(heySocial && current.ws === "hs").data?.counts;

  async function meMenu() {
    const choice = await ch.menu.popup([
      { id: "profile", label: "View profile on the website" },
      { id: "settings", label: "Settings…", accelerator: "CommandOrControl+," },
      { type: "separator" },
      { id: "sign-out", label: `Sign out ${user.name}` },
    ]);
    if (choice === "profile") ch.app.openSite("/profile");
    if (choice === "settings") commands.run("settings");
    if (choice === "sign-out") commands.run("sign-out");
  }

  return (
    <nav className="rail" aria-label="Workspaces and sections">
      <button className={`ws ${current.ws === "ch" ? "on" : ""}`} title="CreatorHive (⌃⌘1)" aria-label="CreatorHive" onClick={() => nav.workspace("ch")}>
        <img src="./ch-logo.svg" alt="" />
        {current.ws !== "ch" && other.total > 0 ? <span className="badge">{countLabel(other.total)}</span> : null}
      </button>
      {heySocial ? (
        <button className={`ws ${current.ws === "hs" ? "on" : ""}`} title="Hey Social Inc. (⌃⌘2)" aria-label="Hey Social Inc." onClick={() => nav.workspace("hs")}>
          <img src="./hs-logo.png" alt="" style={{ width: 25, height: 26 }} />
          {current.ws !== "hs" && other.total > 0 ? <span className="badge">{countLabel(other.total)}</span> : null}
        </button>
      ) : null}
      <div className="rdiv" />
      {SECTIONS[current.ws].map((section) => {
        const meta = SECTION_META[section];
        const Icon = meta.icon;
        const count = section === "dms" ? here.dms : section === "activity" ? (current.ws === "ch" ? activity : hsCounts?.activity ?? 0) : 0;
        return (
          <button key={section} className={`ritem ${current.section === section ? "on" : ""}`}
            title={meta.shortcut ? `${meta.label} (${meta.shortcut})` : meta.label} onClick={() => nav.section(section)}>
            <span className="ib"><Icon /></span>
            {meta.label}
            {count > 0 ? <span className="badge">{countLabel(count)}</span> : null}
          </button>
        );
      })}
      <button className="me" aria-label="Your account" title={user.name} onClick={meMenu}>
        <Avatar name={user.name} src={user.image} size={34} radius="10px" seed={user.id} />
        <span className="presence" />
      </button>
    </nav>
  );
}
