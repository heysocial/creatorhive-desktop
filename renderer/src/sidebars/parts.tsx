import { useState, type ReactNode } from "react";
import { Bell, ChevronDown, MessagesSquare, SquarePen } from "lucide-react";
import { useActivityCounts } from "../lib/activity";
import { ch, type NativeMenuItem } from "../lib/bridge";
import { nav, useNav, type View } from "../lib/nav";
import { sitePathFor } from "../lib/sitePaths";
import { countLabel } from "../lib/ui";

/* An open deal sits over its page; the page's row stays selected. */
const strip = (v: View) => (v.kind === "hub" ? { ...v, dealId: undefined } : v);
const sameView = (a: View, b: View) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

export function SidebarHead({ title, action, actionLabel = "New message" }: { title: string; action?: () => void; actionLabel?: string }) {
  return (
    <div className="sb-head">
      {title}
      {action ? (
        <button className="compose" aria-label={actionLabel} title={actionLabel} onClick={action}><SquarePen /></button>
      ) : null}
    </div>
  );
}

/** One row. Knows whether it's the open view, and offers a native right-click menu. */
export function SidebarItem({ icon, label, view, count, quietCount, honeyCount = false, meta, unread = false, extraMenu = [], onMenu }: {
  icon: ReactNode;
  label: string;
  view: View;
  count?: number;
  quietCount?: number;
  honeyCount?: boolean;
  meta?: string;
  unread?: boolean;
  extraMenu?: NativeMenuItem[];
  onMenu?: (id: string) => void;
}) {
  const { current } = useNav();
  const on = sameView(current.view, view);

  async function contextMenu() {
    const location = { ...current, view };
    const choice = await ch.menu.popup([
      { id: "open", label: "Open" },
      ...extraMenu,
      { type: "separator" },
      { id: "copy-link", label: "Copy link" },
    ]);
    const path = sitePathFor(location);
    if (choice === "open") nav.open(view);
    else if (choice === "copy-link") void navigator.clipboard.writeText(`${(await ch.info()).origin}${path}`);
    else if (choice) onMenu?.(choice);
  }

  return (
    <button
      className={`sb-item ${on ? "on" : unread || count ? "unread" : ""}`}
      data-nav={JSON.stringify(view)}
      data-unread={unread || count ? "1" : undefined}
      aria-current={on ? "page" : undefined}
      onClick={() => nav.open(view)}
      onContextMenu={(event) => {
        event.preventDefault();
        void contextMenu();
      }}
    >
      {icon}
      <span className="label">{label}</span>
      {count ? <span className="cnt">{count > 99 ? "99+" : count}</span> : null}
      {!count && quietCount ? <span className={`cnt quiet ${honeyCount ? "honey" : ""}`}>{quietCount}</span> : null}
      {!count && !quietCount && meta ? <span className="meta">{meta}</span> : null}
    </button>
  );
}

/** A collapsible group ("Channels", "Direct messages"), remembered across launches. */
export function SidebarSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const key = `ch.sb.closed.${id}`;
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setClosed(!closed);
    try {
      localStorage.setItem(key, closed ? "0" : "1");
    } catch {
      // Not remembered; fine.
    }
  };
  return (
    <>
      <button className={`sb-sec ${closed ? "closed" : ""}`} onClick={toggle} aria-expanded={!closed}>
        <ChevronDown />{title}
      </button>
      {closed ? null : children}
    </>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <>{Array.from({ length: rows }, (_, i) => <div key={i} className="sb-skel" style={{ width: `${70 - i * 9}%` }} />)}</>;
}

/**
 * CreatorHive's Activity and Threads, pinned at the top of every CreatorHive
 * sidebar the way Slack has them, each with its red count. They open in Home,
 * so the channel list stays beside them and one click goes straight back.
 */
export function ActivityRows() {
  const { current } = useNav();
  const counts = useActivityCounts();
  const open = current.ws === "ch" && current.view.kind === "activity" ? (current.view.tab === "threads" ? "threads" : "activity") : null;
  const row = (key: "activity" | "threads", label: string, icon: ReactNode, view: View) => {
    const count = counts[key];
    const on = open === key;
    return (
      <button key={key} className={`sb-item ${on ? "on" : count ? "unread" : ""}`} data-nav={JSON.stringify(view)} data-act-row={key}
        aria-current={on ? "page" : undefined} aria-label={count ? `${label}, ${count} unread` : label}
        onClick={() => nav.open(view, "home", "ch")}>
        {icon}
        <span className="label">{label}</span>
        {count ? <span className="cnt">{countLabel(count)}</span> : null}
      </button>
    );
  };
  return (
    <div className="sb-act-rows">
      {row("activity", "Activity", <Bell />, { kind: "activity" })}
      {row("threads", "Threads", <MessagesSquare />, { kind: "activity", tab: "threads" })}
    </div>
  );
}
