import { Bell, Bookmark, Clapperboard, GraduationCap, House, Lock, MessageCircle, Shield, Sparkles, type LucideIcon } from "lucide-react";
import { openUpgrade, useHubHidden } from "../lib/access";
import { ch, type SessionUser } from "../lib/bridge";
import { useChannels, useConversations, useHeySocialAccess } from "../lib/api";
import { commands } from "../lib/commands";
import { openSettings } from "../lib/links";
import { nav, useNav, type Section, SECTIONS } from "../lib/nav";
import { Avatar, countLabel } from "../lib/ui";
import { useHsSidebar } from "../lib/heysocial";
import { adminPages, useAdminAccess, useOpenReports } from "../lib/admin";
import { useSupportUnread } from "../lib/support";
import { useVideoEditsBoard } from "../lib/videoEdits";

const SECTION_META: Record<Section, { label: string; icon: LucideIcon; shortcut: string }> = {
  home: { label: "Home", icon: House, shortcut: "⌘1" },
  dms: { label: "DMs", icon: MessageCircle, shortcut: "⌘2" },
  hub: { label: "Hub", icon: Sparkles, shortcut: "⌘3" },
  learn: { label: "Learn", icon: GraduationCap, shortcut: "⌘4" },
  // "Video editing" (the rail's labels are one short word; the tooltip has the full name).
  edits: { label: "Editing", icon: Clapperboard, shortcut: "" },
  activity: { label: "Activity", icon: Bell, shortcut: "⌘5" },
  later: { label: "Later", icon: Bookmark, shortcut: "" },
  admin: { label: "Admin", icon: Shield, shortcut: "" },
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
  const hsCounts = useHsSidebar(heySocial && current.ws === "hs").data?.counts;
  const admin = useAdminAccess().data;
  // The Weekend Starter has no Creator Hub: its rail item shows locked and offers the UGC Academy.
  const hubLocked = useHubHidden();
  const canAdmin = adminPages(admin).length > 0;
  const openReports = useOpenReports(Boolean(admin?.tabs.includes("moderation"))).data ?? 0;
  const supportUnread = useSupportUnread(Boolean(admin?.tabs.includes("support"))).data ?? 0;
  // The video editing board: the owner and the editors only (the API answers 404 to everyone else).
  const edits = useVideoEditsBoard().data;
  const editsWaiting = edits ? edits.counts.submitted + edits.counts.in_editing : 0;

  async function meMenu() {
    const choice = await ch.menu.popup([
      { id: "profile", label: "View profile" },
      { id: "edit", label: "Edit profile…" },
      { id: "settings", label: "Settings…", accelerator: "CommandOrControl+," },
      { type: "separator" },
      { id: "sign-out", label: `Sign out ${user.name}` },
    ]);
    if (choice === "profile") nav.open({ kind: "profile", id: user.id }, "home", "ch");
    if (choice === "edit") openSettings("account");
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
      {SECTIONS[current.ws].filter((section) => (section !== "admin" || canAdmin) && (section !== "edits" || Boolean(edits))).map((section) => {
        const meta = SECTION_META[section];
        const Icon = meta.icon;
        const count = section === "dms" ? here.dms : section === "activity" ? hsCounts?.activity ?? 0 : section === "admin" ? openReports + supportUnread : section === "edits" ? editsWaiting : 0;
        const locked = section === "hub" && hubLocked;
        return (
          <button key={section} className={`ritem ${current.section === section && !locked ? "on" : ""} ${locked ? "locked" : ""}`}
            aria-label={locked ? "Hub, part of the UGC Academy" : undefined}
            title={locked ? "Hub · Part of the UGC Academy" : section === "edits" ? "Video editing" : meta.shortcut ? `${meta.label} (${meta.shortcut})` : meta.label}
            onClick={() => (locked ? openUpgrade() : nav.section(section))}>
            <span className="ib"><Icon />{locked ? <span className="rlock"><Lock /></span> : null}</span>
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
