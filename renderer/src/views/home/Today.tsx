import { useMemo } from "react";
import { AtSign, Calendar, Flame, Sun, Video } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, useChannels, useConversations } from "../../lib/api";
import { useEvents, type CommunityEvent } from "../../lib/events";
import { clock, money } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar, channelName } from "../../lib/ui";
import { useGlance } from "./Home";

interface HubToday {
  tasks: { id: string; brand_name: string; amount_usd: number | string | null; status: string; draft_due_at: string | null; payment_expected_at: string | null }[];
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

/** Counts for the sidebar's "Today" badge: things that need you today. */
export function useTodayCount() {
  const hub = useHubToday().data;
  const glance = useGlance().data;
  return (hub?.tasks.length ?? 0) + (glance?.pastDue.deals.length ? 1 : 0);
}

export function TodayItems() {
  const events = useEvents().all;
  const hub = useHubToday().data;
  const glance = useGlance().data;
  const points = usePoints().data;
  const conversations = useConversations("creatorhive").data ?? [];
  const channels = useChannels("creatorhive").data ?? [];
  const event = useMemo(() => nextEvent(events), [events]);
  const waiting = conversations.filter((c) => c.unreadCount > 0).slice(0, 3);
  const mentioned = channels.filter((c) => c.mentionCount > 0).slice(0, 3);
  const late = glance?.pastDue.deals ?? [];

  return (
    <>
      {event ? (
        <button className="t-card" onClick={() => nav.open({ kind: "events", eventId: event.id }, "home", "ch")}>
          <span className="t-ico honey">{event.joinUrl ? <Video /> : <Calendar />}</span>
          <span><b>{event.title}</b><small>{when(event)}{event.organizer ? ` · ${event.organizer}` : ""}{event.rsvpCount ? ` · ${event.rsvpCount} going` : ""}</small></span>
        </button>
      ) : null}

      {(hub?.tasks.length || late.length) ? <div className="t-label">Today in your Hub</div> : null}
      {late.slice(0, 2).map((deal) => (
        <button key={`late-${deal.id}`} className="t-card" onClick={() => nav.open({ kind: "hub", page: "deals", dealId: deal.id }, "hub", "ch")}>
          <Avatar name={deal.brandName} size={34} radius="9px" />
          <span><b>Payment expected · {deal.brandName}</b><small className="late-text">{money(deal.amountUsd)} · {deal.daysOverdue} {deal.daysOverdue === 1 ? "day" : "days"} late</small></span>
        </button>
      ))}
      {hub?.tasks.slice(0, 3).map((deal) => (
        <button key={deal.id} className="t-card" onClick={() => nav.open({ kind: "hub", page: "deals", dealId: deal.id }, "hub", "ch")}>
          <Avatar name={deal.brand_name} size={34} radius="9px" />
          <span><b>{deal.brand_name}</b><small>{deal.status.replace(/_/g, " ")}{deal.amount_usd ? ` · ${money(deal.amount_usd)}` : ""}</small></span>
        </button>
      ))}

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
      {!event && !hub?.tasks.length && !late.length && !waiting.length && !mentioned.length && !points ? <div className="faint" style={{ padding: 8 }}>Nothing needs you right now.</div> : null}
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
