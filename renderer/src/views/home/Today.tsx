import { useMemo } from "react";
import { AtSign, Calendar, Flame, Sun, Video } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, useChannels, useConversations } from "../../lib/api";
import { useEvents, type CommunityEvent } from "../../lib/events";
import { clock, money } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar, channelName } from "../../lib/ui";
import { useGlance } from "./Home";
import { STATUS_LABELS, type DealStatus } from "../../lib/hub";

interface HubTask { id: string; brand_name: string; amount_usd: number | string | null; status: string; draft_due_at: string | null; payment_expected_at: string | null; updated_at: string }

interface HubToday {
  tasks: HubTask[];
  momentum: { comingUp: { id: string; brandName: string; amountUsd: number; kind: "payment" | "delivery"; label: string; meta: string }[] };
}

export function useHubToday() {
  return useQuery({
    queryKey: ["hub", "today"],
    queryFn: () => api<HubToday>(`/api/hub/today?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`),
  });
}

export function usePoints() {
  return useQuery({
    queryKey: ["points", "me"],
    staleTime: 5 * 60_000,
    queryFn: () => api<{ total: number; currentStreak: number; longestStreak: number }>("/api/points/me"),
  });
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The next event worth showing: today, or the next one this week. */
export function nextEvent(events: CommunityEvent[]) {
  const now = Date.now();
  return events
    .filter((e) => new Date(e.endsAt).getTime() > now && new Date(e.startsAt).getTime() - now < 7 * 86_400_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

function when(event: CommunityEvent) {
  const start = new Date(event.startsAt);
  const now = new Date();
  if (start.getTime() <= now.getTime()) return "Happening now";
  if (sameDay(start, now)) return `Today ${clock(start)}`;
  return `${start.toLocaleDateString([], { weekday: "short" })} ${clock(start)}`;
}

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/*
  The server's `tasks` are the website's "Needs you today": the deals that have
  gone quiet too long, padded up to three with any open deal so the Hub's own
  Today screen is never empty. Here only the ones that really need you count,
  by the same thresholds (lib/hub/deals.ts needsYouToday), and a deal already
  shown as an overdue payment isn't listed twice.
*/
function needsYou(task: HubTask) {
  const days = daysSince(task.updated_at);
  return (task.status === "pitching" && days > 2)
    || (task.status === "pending_payment" && days > 7)
    || (["production", "post_production", "revisions"].includes(task.status) && days > 3);
}

/** The website's wording for each kind of deal that needs you (components/hub/TodayScreen.tsx). */
function taskCopy(task: HubTask) {
  const days = daysSince(task.updated_at);
  const amount = money(Number(task.amount_usd ?? 0));
  if (task.status === "pitching") return { title: `Follow up with ${task.brand_name}`, meta: `Pitched ${days} day${days === 1 ? "" : "s"} ago · ${amount} on the table` };
  if (task.status === "pending_payment") return { title: `Follow up with ${task.brand_name} about payment`, meta: `Last updated ${days} days ago · ${amount}` };
  return { title: `Move ${task.brand_name} forward`, meta: `${STATUS_LABELS[task.status as DealStatus] ?? task.status} · updated ${days}d ago · ${amount}` };
}

/** What Today lists from the Hub: overdue payments (two at most), then the deals that need you. */
function useHubNeeds() {
  const hub = useHubToday().data;
  const glance = useGlance().data;
  const late = (glance?.pastDue.deals ?? []).slice(0, 2);
  const lateIds = new Set(glance?.pastDue.deals.map((d) => d.id));
  const tasks = (hub?.tasks ?? []).filter((t) => needsYou(t) && !lateIds.has(t.id)).slice(0, 3);
  return { late, tasks };
}

/** Counts for the sidebar's "Today" badge: the Hub items Today lists. */
export function useTodayCount() {
  const { late, tasks } = useHubNeeds();
  return late.length + tasks.length;
}

export function TodayItems() {
  const { all: events, calendarUnavailable } = useEvents();
  const { late, tasks } = useHubNeeds();
  const points = usePoints().data;
  const conversations = useConversations("creatorhive").data ?? [];
  const channels = useChannels("creatorhive").data ?? [];
  const event = useMemo(() => nextEvent(events), [events]);
  const waiting = conversations.filter((c) => c.unreadCount > 0).slice(0, 3);
  const mentioned = channels.filter((c) => c.mentionCount > 0).slice(0, 3);

  return (
    <>
      {event ? (
        <button className="t-card" onClick={() => nav.open({ kind: "events", eventId: event.id }, "home", "ch")}>
          <span className="t-ico honey">{event.joinUrl ? <Video /> : <Calendar />}</span>
          <span><b>{event.title}</b><small>{when(event)}{event.organizer ? ` · ${event.organizer}` : ""}{event.rsvpCount ? ` · ${event.rsvpCount} going` : ""}</small></span>
        </button>
      ) : calendarUnavailable ? <div className="faint t-note">Coaching calls are temporarily unavailable.</div> : null}

      {(tasks.length || late.length) ? <div className="t-label">Today in your Hub</div> : null}
      {late.map((deal) => (
        <button key={`late-${deal.id}`} className="t-card" onClick={() => nav.open({ kind: "hub", page: "deals", dealId: deal.id }, "hub", "ch")}>
          <Avatar name={deal.brandName} size={34} radius="9px" />
          <span><b>Payment expected · {deal.brandName}</b><small className="late-text">{money(deal.amountUsd)} · {deal.daysOverdue} {deal.daysOverdue === 1 ? "day" : "days"} late</small></span>
        </button>
      ))}
      {tasks.map((deal) => {
        const copy = taskCopy(deal);
        return (
          <button key={deal.id} className="t-card" onClick={() => nav.open({ kind: "hub", page: "deals", dealId: deal.id }, "hub", "ch")}>
            <Avatar name={deal.brand_name} size={34} radius="9px" />
            <span><b>{copy.title}</b><small>{copy.meta}</small></span>
          </button>
        );
      })}

      {waiting.length || mentioned.length ? <div className="t-label">Waiting on you</div> : null}
      {waiting.map((c) => (
        <button key={c.id} className="t-card" onClick={() => nav.open({ kind: "dm", id: c.id }, "home", "ch")}>
          <Avatar name={c.displayName} src={c.isGroup ? null : c.other?.avatarUrl} seed={c.other?.id ?? c.id} size={34} />
          <span><b>{c.displayName}</b><small>{c.lastMessagePreview ? `"${c.lastMessagePreview.slice(0, 60)}"` : ""} · {c.unreadCount} unread</small></span>
        </button>
      ))}
      {mentioned.map((c) => (
        <button key={c.id} className="t-card" onClick={() => nav.open({ kind: "channel", id: c.id }, "home", "ch")}>
          <span className="t-ico"><AtSign /></span>
          <span><b>You were mentioned in #{channelName(c.name)}</b><small>{c.mentionCount} {c.mentionCount === 1 ? "mention" : "mentions"}</small></span>
        </button>
      ))}

      {points ? (
        <>
          <div className="t-label">Streak</div>
          <div className="t-card static">
            <span className="t-ico flame"><Flame /></span>
            <span><b>{points.currentStreak === 1 ? "1 day in a row" : `${points.currentStreak} days in a row`}</b><small>Open CreatorHive each day: +5 points</small></span>
          </div>
        </>
      ) : null}
      {!event && !tasks.length && !late.length && !waiting.length && !mentioned.length && !points ? <div className="faint" style={{ padding: 8 }}>Nothing needs you right now.</div> : null}
    </>
  );
}

/** The right-hand panel on Home: your day across the community and the Hub. */
export function TodayPanel() {
  return (
    <aside className="today-panel scroll">
      <div className="t-head"><Sun /><b>Today</b><span className="faint">{new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span></div>
      <TodayItems />
    </aside>
  );
}

/** Today as its own page (sidebar → Today). */
export function TodayPage() {
  return (
    <div className="page">
      <div className="mhead"><h1><Sun />Today</h1><span className="sub">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>
      <div className="scroll page-body"><div className="today-page"><TodayItems /></div></div>
    </div>
  );
}
