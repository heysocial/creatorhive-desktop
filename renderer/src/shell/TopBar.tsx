import { ArrowLeft, ArrowRight, Bell, PanelLeft, Search } from "lucide-react";
import { useActivityRefresh, useActivityUnread } from "../lib/activity";
import { commands } from "../lib/commands";
import { nav, useNav } from "../lib/nav";
import { useConnectionState } from "../lib/realtime";
import { countLabel } from "../lib/ui";

export function TopBar({ preview, sidebarOpen }: { preview: boolean; sidebarOpen: boolean }) {
  const connection = useConnectionState();
  const ws = nav.get().ws;
  const { current } = useNav();
  const unread = useActivityUnread();
  useActivityRefresh();
  const reconnecting = connection === "disconnected" || connection === "suspended" || connection === "connecting";

  return (
    <header className="topbar">
      <div className="navbtns">
        <button className="iconbtn" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={!sidebarOpen}
          title={`${sidebarOpen ? "Hide" : "Show"} sidebar (⇧⌘D)`} onClick={() => commands.run("toggle-sidebar")}><PanelLeft /></button>
        <button className="iconbtn" aria-label="Back" title="Back (⌘[)" disabled={!nav.canGoBack()} onClick={() => nav.back()}><ArrowLeft /></button>
        <button className="iconbtn" aria-label="Forward" title="Forward (⌘])" disabled={!nav.canGoForward()} onClick={() => nav.forward()}><ArrowRight /></button>
      </div>
      <button className="search-trigger" onClick={() => commands.run("quick-open")}>
        <Search />
        <span>{ws === "hs" ? "Search Hey Social Inc." : "Search CreatorHive"}</span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="topright">
        {reconnecting ? <span className="conn" title="Live updates are reconnecting"><i />Reconnecting…</span> : null}
        {preview ? <span className="preview-tag" title="The team's preview of CreatorHive 2.0">PREVIEW</span> : null}
        {ws === "ch" ? (
          // CreatorHive's Activity: mentions (old threads too), replies in my threads, reactions, comments.
          <button className={`iconbtn bell ${current.section === "activity" ? "on" : ""}`} aria-label={unread ? `Activity, ${unread} unread` : "Activity"}
            title={`Activity (⌘5)${unread ? ` · ${unread} unread` : ""}`} onClick={() => nav.section("activity", "ch")}>
            <Bell />
            {unread > 0 ? <span className="badge">{countLabel(unread)}</span> : null}
          </button>
        ) : null}
      </div>
    </header>
  );
}
