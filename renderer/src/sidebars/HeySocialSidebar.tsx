import { useEffect, useMemo, useState } from "react";
import { AtSign, BellOff, Bookmark, ChevronDown, Hash, Headphones, Lock, MessagesSquare, Plus, SquarePen } from "lucide-react";
import { ch } from "../lib/bridge";
import { api } from "../lib/api";
import { commands } from "../lib/commands";
import { addSection, refreshHs, setPrefs, useHsSidebar, useHuddles, type HsChannel, type HsDm, type Section } from "../lib/heysocial";
import { Avatar, channelName } from "../lib/ui";
import { promptText } from "../views/hub/DealPanel";
import { HuddleBar } from "../views/heysocial/Huddle";
import { HsPreferences } from "../views/heysocial/Preferences";
import { leaveChannel, RenameChannel } from "../views/heysocial/ChannelAdmin";
import { useAdminAccess } from "../lib/admin";
import { nav } from "../lib/nav";
import { SidebarItem, Skeleton } from "./parts";

/*
  Hey Social Inc.'s sidebar, the way the website draws it (which copies Slack):
  Threads, Mentions & reactions, Saved for later, then Starred, your sections,
  Channels and Direct messages, each item in exactly one of them.
*/

type Item = { kind: "channel"; row: HsChannel } | { kind: "dm"; row: HsDm };

const COLLAPSE_KEY = "hey-social.sidebar.collapsed";
function useBuiltinCollapsed() {
  const [state, setState] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}"); } catch { return {}; } });
  const toggle = (key: string) => {
    const next = { ...state, [key]: !state[key] };
    setState(next);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* fine */ }
  };
  return [state, toggle] as const;
}

const lastActivity = (item: Item) => Date.parse((item.row as HsDm).lastMessageAt ?? (item.row as HsDm).createdAt ?? "") || 0;

/** Direct messages: newest conversation first, as in Slack. A saved drag position never pins a DM there. */
const byLatestMessage = (items: Item[]) => [...items].sort((a, b) => lastActivity(b) - lastActivity(a));

function sortItems(items: Item[]) {
  return [...items].sort((a, b) => {
    const ao = a.row.sortOrder ?? Infinity;
    const bo = b.row.sortOrder ?? Infinity;
    if (ao !== bo) return ao - bo;
    if (a.kind !== b.kind) return a.kind === "channel" ? -1 : 1;
    if (a.kind === "channel" && b.kind === "channel") return channelName(a.row.name).localeCompare(channelName(b.row.name));
    return lastActivity(b) - lastActivity(a);
  });
}

function Row({ item, sections, live, isMember }: { item: Item; sections: Section[]; live: boolean; isMember: boolean }) {
  const { row } = item;
  const muted = row.muted;
  const unread = item.kind === "channel" ? item.row.unreadCount : item.row.unreadCount;
  const badge = item.kind === "channel" ? item.row.mentionCount : muted ? 0 : item.row.unreadCount;
  const bold = unread > 0 && (!muted || badge > 0);
  const view = { kind: item.kind, id: row.id } as const;
  const [renaming, setRenaming] = useState(false);

  async function menu() {
    const moves = [
      ...sections.filter((s) => s.id !== row.sectionId).map((s) => ({ id: `move:${s.id}`, label: s.name })),
      ...(row.sectionId ? [{ id: "move:none", label: item.kind === "channel" ? "Channels" : "Direct messages" }] : []),
      { type: "separator" as const },
      { id: "move:new", label: "New section…" },
    ];
    const choice = await ch.menu.popup([
      { id: "star", label: row.starred ? "Unstar" : "Star" },
      { id: "mute", label: muted ? "Unmute" : "Mute" },
      { id: "move", label: "Move to", submenu: moves },
      // As on the website: Rename for full members, Leave for everyone.
      ...(item.kind === "channel" ? [{ type: "separator" as const }, ...(isMember ? [{ id: "rename", label: "Rename channel…" }] : []), { id: "leave", label: "Leave channel" }] : []),
      { type: "separator" },
      { id: "window", label: "Open in new window" },
    ]);
    if (!choice) return;
    if (choice === "star") void setPrefs(item.kind, row.id, { starred: !row.starred });
    if (choice === "mute") void setPrefs(item.kind, row.id, { muted: !muted });
    if (choice === "move:none") void setPrefs(item.kind, row.id, { sectionId: null });
    if (choice.startsWith("move:") && choice !== "move:none" && choice !== "move:new") void setPrefs(item.kind, row.id, { sectionId: choice.slice(5), starred: false });
    if (choice === "move:new") {
      const name = await promptText("New section");
      if (name) { const section = await addSection(name.slice(0, 40)); void setPrefs(item.kind, row.id, { sectionId: section.id, starred: false }); }
    }
    if (choice === "rename" && item.kind === "channel") setRenaming(true);
    if (choice === "leave" && item.kind === "channel" && (await leaveChannel(item.row))) {
      const here = nav.get().view;
      if (here.kind === "channel" && here.id === row.id) nav.open({ kind: "threads" }, "home", "hs");
    }
    if (choice === "window") ch.window.popout({ kind: item.kind, id: row.id });
  }

  const icon = item.kind === "channel"
    ? (item.row.isPrivate && !item.row.workspaceOpen ? <Lock /> : <Hash />)
    : <Avatar name={item.row.displayName} src={item.row.isGroup ? null : item.row.other?.avatarUrl} seed={item.row.isGroup ? item.row.id : item.row.other?.id} size={20} radius="5px" presence={item.row.isGroup ? undefined : item.row.other?.presence} />;
  const label = item.kind === "channel" ? channelName(item.row.name) : item.row.displayName;
  return (
    <>
    <div className={`hs-row ${muted ? "muted" : ""}`} onContextMenu={(e) => { e.preventDefault(); void menu(); }}>
      <SidebarItem icon={icon} label={label} view={view} count={badge || undefined} unread={bold} />
      <span className="hs-row-icons">
        {live ? <Headphones className="live" /> : null}
        {muted && !badge ? <BellOff /> : null}
      </span>
    </div>
    {renaming && item.kind === "channel" ? <RenameChannel channel={item.row} onClose={() => setRenaming(false)} /> : null}
    </>
  );
}

function SectionBlock({ id, title, items, collapsed, onToggle, sections, liveIds, isMember, onMenu, onAdd, empty }: {
  id: string; title: string; items: Item[]; collapsed: boolean; onToggle: () => void; sections: Section[]; liveIds: Set<string>; isMember: boolean;
  onMenu?: () => void; onAdd?: () => void; empty?: React.ReactNode;
}) {
  // A collapsed section still shows what's unread, as Slack does.
  const shown = collapsed ? items.filter((i) => (i.kind === "channel" ? i.row.mentionCount || (i.row.unreadCount && !i.row.muted) : i.row.unreadCount && !i.row.muted)) : items;
  return (
    <div className="hs-section" data-section={id}>
      <div className="hs-sec-head">
        <button className={`sb-sec ${collapsed ? "closed" : ""}`} onClick={onToggle} onContextMenu={(e) => { if (onMenu) { e.preventDefault(); onMenu(); } }}><ChevronDown />{title}</button>
        {onAdd ? <button className="hs-add" title="Add" onClick={onAdd}><Plus /></button> : null}
      </div>
      {shown.map((item) => <Row key={`${item.kind}:${item.row.id}`} item={item} sections={sections} live={liveIds.has(item.row.id)} isMember={isMember} />)}
      {!collapsed && items.length === 0 ? empty ?? null : null}
    </div>
  );
}

export function HeySocialSidebar() {
  const { data, isLoading } = useHsSidebar();
  const isOwner = Boolean(useAdminAccess().data?.owner);
  const huddles = useHuddles().data;
  const [collapsed, toggleBuiltin] = useBuiltinCollapsed();
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => {
    const open = () => setPrefsOpen(true);
    window.addEventListener("ch:hs-preferences", open);
    return () => window.removeEventListener("ch:hs-preferences", open);
  }, []);
  const isMember = data?.access === "member";
  const liveIds = useMemo(() => new Set((huddles?.huddles ?? []).map((h) => h.target.id)), [huddles]);

  const groups = useMemo(() => {
    if (!data) return null;
    const sectionIds = new Set(data.sections.map((s) => s.id));
    const items: Item[] = [
      ...data.channels.filter((c) => c.joined).map((row) => ({ kind: "channel" as const, row })),
      ...data.dms.map((row) => ({ kind: "dm" as const, row })),
    ];
    const starred = items.filter((i) => i.row.starred);
    const rest = items.filter((i) => !i.row.starred);
    const inSection = (i: Item) => (i.row.sectionId && sectionIds.has(i.row.sectionId) ? i.row.sectionId : null);
    return {
      starred: sortItems(starred),
      sections: [...data.sections].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ section: s, items: sortItems(rest.filter((i) => inSection(i) === s.id)) })),
      channels: sortItems(rest.filter((i) => i.kind === "channel" && !inSection(i))),
      dms: byLatestMessage(rest.filter((i) => i.kind === "dm" && !inSection(i))),
      browse: data.channels.filter((c) => !c.joined && c.workspaceOpen),
    };
  }, [data]);

  async function headerMenu() {
    const choice = await ch.menu.popup([
      ...(isMember ? [{ id: "create", label: "Create a channel…" }, { id: "browse", label: "Browse channels" }] : []),
      { id: "section", label: "Create a section…" },
      { type: "separator" },
      { id: "prefs", label: "Preferences and themes…" },
      // People and access is the owner's alone, as on the website.
      ...(isOwner ? [{ id: "people", label: "People and access" }] : []),
    ]);
    if (choice === "create") window.dispatchEvent(new Event("ch:hs-create-channel"));
    if (choice === "browse") window.dispatchEvent(new Event("ch:hs-browse"));
    if (choice === "section") { const name = await promptText("New section"); if (name) await addSection(name.slice(0, 40)); }
    if (choice === "prefs") setPrefsOpen(true);
    if (choice === "people") nav.open({ kind: "hs-people" }, "home", "hs");
  }

  async function sectionMenu(section: Section) {
    const choice = await ch.menu.popup([{ id: "rename", label: "Rename…" }, { type: "separator" }, { id: "delete", label: "Delete section…" }]);
    if (choice === "rename") {
      const name = await promptText("Rename section", section.name);
      if (name) { await api("/api/hey-social/sidebar/sections", { method: "PATCH", body: { id: section.id, name: name.slice(0, 40) } }).catch(() => null); void refreshHs(); }
    }
    if (choice === "delete" && window.confirm(`Delete "${section.name}"? Its channels and messages go back to Channels and Direct messages.`)) {
      await api(`/api/hey-social/sidebar/sections?id=${section.id}`, { method: "DELETE" }).catch(() => null);
      void refreshHs();
    }
  }

  const label = (key: "starred" | "channels" | "dms", fallback: string) => data?.builtinLabels[key] || fallback;
  const counts = data?.counts;

  return (
    <>
      <div className="sb-head">
        <button className="hs-name" onClick={() => void headerMenu()}>Hey Social Inc.<ChevronDown /></button>
        <button className="compose" aria-label="New message" title="New message (⌘N)" onClick={() => commands.run("new-message")}><SquarePen /></button>
      </div>
      {data ? <div className="hs-pill">{data.access === "guest" ? "Guest access" : `Team only · ${data.memberCount} members`}</div> : null}
      <div className="sb-scroll">
        <SidebarItem icon={<MessagesSquare />} label="Threads" view={{ kind: "threads" }} count={counts?.threads || undefined} unread={Boolean(counts?.threads)} />
        <SidebarItem icon={<AtSign />} label="Mentions & reactions" view={{ kind: "mentions" }} count={counts?.activity || undefined} />
        <SidebarItem icon={<Bookmark />} label="Saved for later" view={{ kind: "saved" }} quietCount={counts?.saved || undefined} />
        {isLoading ? <Skeleton rows={6} /> : null}
        {groups ? (
          <>
            {groups.starred.length ? <SectionBlock id="starred" title={label("starred", "Starred")} items={groups.starred} collapsed={Boolean(collapsed.starred)} onToggle={() => toggleBuiltin("starred")} sections={data!.sections} liveIds={liveIds} isMember={isMember} /> : null}
            {groups.sections.map(({ section, items }) => (
              <SectionBlock key={section.id} id={section.id} title={section.name} items={items} collapsed={section.collapsed} sections={data!.sections} liveIds={liveIds} isMember={isMember}
                onToggle={async () => { await api("/api/hey-social/sidebar/sections", { method: "PATCH", body: { id: section.id, collapsed: !section.collapsed } }).catch(() => null); void refreshHs(); }}
                onMenu={() => void sectionMenu(section)} empty={<div className="sb-empty">Move channels or messages here from their menu</div>} />
            ))}
            <SectionBlock id="channels" title={label("channels", "Channels")} items={groups.channels} collapsed={Boolean(collapsed.channels)} onToggle={() => toggleBuiltin("channels")} sections={data!.sections} liveIds={liveIds} isMember={isMember}
              onAdd={isMember ? () => window.dispatchEvent(new Event("ch:hs-create-channel")) : undefined}
              empty={isMember ? <button className="sb-item" onClick={() => window.dispatchEvent(new Event("ch:hs-create-channel"))}><Plus />Create a channel</button> : null} />
            {isMember && groups.browse.length ? <button className="sb-item faint-row" onClick={() => window.dispatchEvent(new Event("ch:hs-browse"))}><Hash />Browse {groups.browse.length} {groups.browse.length === 1 ? "channel" : "channels"}</button> : null}
            <SectionBlock id="dms" title={label("dms", "Direct messages")} items={groups.dms} collapsed={Boolean(collapsed.dms)} onToggle={() => toggleBuiltin("dms")} sections={data!.sections} liveIds={liveIds} isMember={isMember}
              onAdd={() => commands.run("new-message")} empty={<button className="sb-item" onClick={() => commands.run("new-message")}><Plus />Message a teammate</button>} />
            <button className="sb-item faint-row" onClick={async () => { const name = await promptText("New section"); if (name) await addSection(name.slice(0, 40)); }}><Plus />Add a section</button>
          </>
        ) : null}
      </div>
      <HuddleBar />
      {prefsOpen ? <HsPreferences onClose={() => setPrefsOpen(false)} /> : null}
    </>
  );
}
