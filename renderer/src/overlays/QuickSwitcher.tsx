import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell, Calendar, ChartNoAxesCombined, Contact, FileText, GraduationCap, Hash, House, Kanban, Keyboard, Lock,
  LogOut, MessageCircle, Receipt, Search, Trophy, User, Users, ArrowLeftRight,
} from "lucide-react";
import { api, useChannels, useConversations, useHeySocialAccess, useSearch } from "../lib/api";
import { useQuery } from "@tanstack/react-query";
import { placeView, type Place } from "../lib/heysocial";
import { commands } from "../lib/commands";
import { openPath } from "../lib/links";
import { nav, type Location } from "../lib/nav";
import { Avatar, channelName } from "../lib/ui";

interface Row {
  id: string;
  group: string;
  title: string;
  sub?: string;
  glyph: ReactNode;
  hint?: string;
  run: () => void;
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Best matches first: starts-with, then word-start, then anywhere. */
function score(text: string, q: string) {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s\-_]+/).some((word) => word.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

const glyph = (icon: ReactNode) => <span className="glyph">{icon}</span>;
const go = (location: Location) => () => nav.open(location.view, location.section, location.ws);

const SCREENS: { title: string; icon: ReactNode; location: Location; hint?: string }[] = [
  { title: "Home", icon: <House />, location: { ws: "ch", section: "home", view: { kind: "feed" } }, hint: "⌘1" },
  { title: "Events", icon: <Calendar />, location: { ws: "ch", section: "home", view: { kind: "events" } } },
  { title: "Leaderboard", icon: <Trophy />, location: { ws: "ch", section: "home", view: { kind: "leaderboard" } } },
  { title: "Members", icon: <Users />, location: { ws: "ch", section: "home", view: { kind: "members" } } },
  { title: "Deals", icon: <Kanban />, location: { ws: "ch", section: "hub", view: { kind: "hub", page: "deals" } }, hint: "⌘3" },
  { title: "Dashboard", icon: <ChartNoAxesCombined />, location: { ws: "ch", section: "hub", view: { kind: "hub", page: "dashboard" } } },
  { title: "Past clients", icon: <Contact />, location: { ws: "ch", section: "hub", view: { kind: "hub", page: "clients" } } },
  { title: "Invoices", icon: <Receipt />, location: { ws: "ch", section: "hub", view: { kind: "hub", page: "invoices" } } },
  { title: "Courses", icon: <GraduationCap />, location: { ws: "ch", section: "learn", view: { kind: "learn", page: "courses" } }, hint: "⌘4" },
  { title: "Activity", icon: <Bell />, location: { ws: "ch", section: "activity", view: { kind: "activity" } }, hint: "⌘5" },
];

export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const heySocial = useHeySocialAccess().data === true;
  const chChannels = useChannels("creatorhive").data ?? [];
  const hsChannels = useChannels("heysocial", heySocial).data ?? [];
  const chDms = useConversations("creatorhive").data ?? [];
  const hsDms = useConversations("heysocial", heySocial).data ?? [];
  const debounced = useDebounced(query, 200);
  const remote = useSearch(debounced);
  // In Hey Social Inc., its own message search (the website's /api/hey-social/search).
  const inHs = heySocial && nav.get().ws === "hs";
  const hsSearch = useQuery({
    queryKey: ["hey-social", "search", debounced.trim()],
    enabled: inHs && debounced.trim().length >= 2,
    queryFn: () => api<{ messages: { id: string; preview: string; author: { name: string; avatarUrl: string | null }; place: Place & { thread: boolean } }[] }>(`/api/hey-social/search?tab=messages&q=${encodeURIComponent(debounced.trim())}`),
  });

  const rows = useMemo<Row[]>(() => {
    const ranked = <T,>(items: T[], text: (item: T) => string, limit: number) =>
      items.map((item) => ({ item, s: score(text(item), q) })).filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.item);

    const dms = ranked([...chDms.map((c) => ({ c, ws: "ch" as const })), ...hsDms.map((c) => ({ c, ws: "hs" as const }))]
      .sort((a, b) => (b.c.lastMessageAt ?? "").localeCompare(a.c.lastMessageAt ?? "")), (x) => x.c.displayName, q ? 6 : 5)
      .map<Row>(({ c, ws }) => ({
        id: `dm:${c.id}`, group: "Direct messages", title: c.displayName,
        sub: [ws === "hs" ? "Hey Social Inc." : "", c.lastMessagePreview ?? ""].filter(Boolean).join(" · "),
        glyph: <Avatar name={c.displayName} src={c.isGroup ? null : c.other?.avatarUrl} seed={c.isGroup ? c.id : c.other?.id} size={28} radius="8px" />,
        hint: c.unreadCount ? `${c.unreadCount} new` : undefined,
        run: go({ ws, section: nav.get().ws === ws && nav.get().section === "dms" ? "dms" : "home", view: { kind: "dm", id: c.id } }),
      }));

    const channels = ranked([...chChannels.map((c) => ({ c, ws: "ch" as const })), ...hsChannels.map((c) => ({ c, ws: "hs" as const }))]
      .filter(({ c }) => c.joined || !c.isPrivate), (x) => channelName(x.c.name), q ? 6 : 0)
      .map<Row>(({ c, ws }) => ({
        id: `channel:${c.id}`, group: "Channels", title: channelName(c.name),
        sub: ws === "hs" ? "Hey Social Inc." : c.description ?? undefined,
        glyph: glyph(c.isPrivate ? <Lock /> : <Hash />),
        run: go({ ws, section: "home", view: { kind: "channel", id: c.id } }),
      }));

    const screens = ranked(SCREENS, (s) => s.title, q ? 4 : 0).map<Row>((s) => ({
      id: `screen:${s.title}`, group: "Go to", title: s.title, glyph: glyph(s.icon), hint: s.hint, run: go(s.location),
    }));

    const actions: Row[] = [
      { id: "new-message", group: "Actions", title: "New message", glyph: glyph(<MessageCircle />), hint: "⌘N", run: () => commands.run("new-message") },
      ...(heySocial ? [{
        id: "switch", group: "Actions", title: nav.get().ws === "hs" ? "Switch to CreatorHive" : "Switch to Hey Social Inc.",
        glyph: glyph(<ArrowLeftRight />), hint: nav.get().ws === "hs" ? "⌃⌘1" : "⌃⌘2",
        run: () => commands.run(nav.get().ws === "hs" ? "workspace:ch" : "workspace:hs"),
      }] : []),
      { id: "shortcuts", group: "Actions", title: "Keyboard shortcuts", glyph: glyph(<Keyboard />), hint: "⌘/", run: () => commands.run("shortcuts") },
      { id: "sign-out", group: "Actions", title: "Sign out", glyph: glyph(<LogOut />), run: () => commands.run("sign-out") },
    ].filter((action) => (q ? score(action.title, q) > 0 : action.id !== "sign-out"));

    const server: Row[] = q.length >= 2
      ? (remote.data ?? []).flatMap((group) => group.items.slice(0, 4).map<Row>((item) => ({
          id: `search:${item.id}`, group: group.label, title: item.title,
          sub: item.snippet ?? item.subtitle ?? undefined,
          glyph: group.type === "people"
            ? <Avatar name={item.title} src={item.avatarUrl} size={28} radius="8px" />
            : glyph(group.type === "courses" ? <GraduationCap /> : group.type === "direct-messages" ? <MessageCircle /> : group.type === "feedback" ? <Hash /> : group.type === "people" ? <User /> : <FileText />),
          run: () => openPath(item.href),
        })))
        // Someone already listed under Direct messages doesn't need repeating as a person.
        .filter((row) => !(row.id.startsWith("search:person:") && dms.some((dm) => dm.title === row.title)))
      : [];

    const hsMessages: Row[] = q.length >= 2 && inHs ? (hsSearch.data?.messages ?? []).slice(0, 8).map((m) => ({
      id: `hs:${m.id}`, group: "Messages in Hey Social Inc.", title: m.preview, sub: `${m.author.name} · ${m.place.label}`,
      glyph: <Avatar name={m.author.name} src={m.author.avatarUrl} size={28} radius="8px" />,
      run: () => nav.open(placeView(m.place), "home", "hs"),
    })) : [];

    return [...dms, ...channels, ...screens, ...hsMessages, ...server, ...actions];
  }, [q, chChannels, hsChannels, chDms, hsDms, remote.data, heySocial, hsSearch.data, inHs]);

  useEffect(() => setSelected(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".palette-row.sel")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function choose(row: Row | undefined) {
    if (!row) return;
    onClose();
    row.run();
  }

  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Search" onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected((i) => Math.min(rows.length - 1, i + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected((i) => Math.max(0, i - 1)); }
        if (event.key === "Enter") { event.preventDefault(); choose(rows[selected]); }
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }}>
        <div className="palette-input">
          <Search />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a person, channel, page or lesson…" aria-label="Search" />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">{remote.isFetching ? "Searching…" : q ? `Nothing found for "${query.trim()}".` : "Start typing to search."}</div>
          ) : rows.map((row, index) => {
            const header = row.group !== lastGroup ? <div className="palette-group">{row.group}</div> : null;
            lastGroup = row.group;
            return (
              <div key={row.id}>
                {header}
                <button className={`palette-row ${index === selected ? "sel" : ""}`} role="option" aria-selected={index === selected}
                  onMouseMove={() => setSelected(index)} onClick={() => choose(row)}>
                  {row.glyph}
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="t">{row.title}</span>
                    {row.sub ? <span className="s">{row.sub}</span> : null}
                  </span>
                  {row.hint ? <span className="hint">{row.hint}</span> : index === selected ? <span className="hint">↵</span> : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
      </div>
    </div>
  );
}
