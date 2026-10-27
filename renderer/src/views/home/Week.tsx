import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarPlus, Check } from "lucide-react";
import { ch } from "../../lib/bridge";
import { eventIcs, toggleRsvp, useEvents, type CommunityEvent } from "../../lib/events";
import { clock, money } from "../../lib/format";
import { allDeals, total, useDeals } from "../../lib/hub";
import { nav } from "../../lib/nav";
import { paidThisWeek, smartDeals } from "../hub/Deals";
import { usePoints } from "./Today";

/*
  The right-hand side of Home (Simon's Option A · This week): a banner while a
  call is about to start or is live, the week's events, and the member's week
  in the Hub. Times are the Mac's own time zone, which is the member's.
*/

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Now, moved on every 30 seconds so countdowns and Join buttons keep up. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/*
  "ET", "COT": the website's EventOfDayCard zoneAbbrev, but North America by its
  everyday name (ET, not EST/EDT), as the mockup has it. Elsewhere, the zone's
  own short name, or the place it is named after.
*/
const ZONES: Record<string, string> = {
  "America/New_York": "ET", "America/Toronto": "ET", "America/Detroit": "ET", "America/Montreal": "ET", "America/Indiana/Indianapolis": "ET",
  "America/Chicago": "CT", "America/Winnipeg": "CT", "America/Denver": "MT", "America/Edmonton": "MT", "America/Phoenix": "MST",
  "America/Los_Angeles": "PT", "America/Vancouver": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HST", "America/Halifax": "AT",
  "America/Bogota": "COT", "America/Lima": "PET", "America/Mexico_City": "CST", "America/Sao_Paulo": "BRT", "America/Argentina/Buenos_Aires": "ART",
  "Asia/Dubai": "GST", "Asia/Kolkata": "IST", "Asia/Singapore": "SGT", "Asia/Tokyo": "JST",
};
const DST_PAIRS: Record<string, [string, string]> = {
  "Europe/London": ["GMT", "BST"], "Europe/Dublin": ["GMT", "IST"], "Europe/Paris": ["CET", "CEST"], "Europe/Madrid": ["CET", "CEST"],
  "Europe/Berlin": ["CET", "CEST"], "Europe/Rome": ["CET", "CEST"], "Europe/Amsterdam": ["CET", "CEST"], "Australia/Sydney": ["AEST", "AEDT"],
};
/** Minutes ahead of UTC in `timeZone` on `date`. */
function offset(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
export function zoneAbbrev(date: Date, timeZone = zone()) {
  if (ZONES[timeZone]) return ZONES[timeZone];
  const pair = DST_PAIRS[timeZone];
  if (pair) {
    // Summer time is whichever offset is the larger of January's and July's.
    const year = date.getFullYear();
    const standard = Math.min(offset(new Date(year, 0, 1), timeZone), offset(new Date(year, 6, 1), timeZone));
    return offset(date, timeZone) > standard ? pair[1] : pair[0];
  }
  const short = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  // "GMT-5" says little; the place the zone is named after says more.
  return !short || /^GMT[+-]/.test(short) ? timeZone.split("/").pop()!.replace(/_/g, " ") : short;
}

const startOf = (e: CommunityEvent) => new Date(e.startsAt).getTime();
const endOf = (e: CommunityEvent) => new Date(e.endsAt).getTime();
const isLive = (e: CommunityEvent, now: number) => startOf(e) <= now && now < endOf(e);
/** Join shows from 10 minutes before the start until the end. */
const canJoin = (e: CommunityEvent, now: number) => startOf(e) - now <= 10 * MINUTE && now < endOf(e);
const openEvent = (e: CommunityEvent) => nav.open({ kind: "events", eventId: e.id }, "home", "ch");
const join = (e: CommunityEvent) => { if (e.joinUrl) ch.app.openExternal(e.joinUrl); };

/* ---------- The banner ---------- */

function Banner({ events, now }: { events: CommunityEvent[]; now: number }) {
  const event = events.find((e) => now < endOf(e) && startOf(e) - now <= 30 * MINUTE);
  if (!event) return null;
  const live = isLive(event, now);
  const minutes = Math.max(1, Math.ceil((startOf(event) - now) / MINUTE));
  return (
    <div className={`wk-banner ${live ? "live" : ""}`}>
      <button className="wk-banner-text" onClick={() => openEvent(event)}>
        <i className="wk-dot" />
        {live ? <span>Live now · <b>{event.title}</b></span> : <span><b>{event.title}</b> starts in {minutes} min</span>}
      </button>
      {live ? <button className="wk-banner-join" disabled={!event.joinUrl} title={event.joinUrl ? undefined : "Link coming soon"} onClick={() => join(event)}>Join</button> : null}
    </div>
  );
}

/* ---------- This week ---------- */

function Action({ event, now }: { event: CommunityEvent; now: number }) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  if (canJoin(event, now)) {
    return <button className="btn honey wk-act" disabled={!event.joinUrl} title={event.joinUrl ? undefined : "Link coming soon"} onClick={() => join(event)}>Join</button>;
  }
  if (event.source === "community") {
    return (
      <button className={`btn wk-act ${event.rsvpd ? "going" : ""}`} disabled={busy} onClick={async () => {
        setBusy(true);
        try { await toggleRsvp(event); } catch { window.alert("Couldn't save your RSVP."); } finally { setBusy(false); }
      }}>{event.rsvpd ? <>Going<Check /></> : "RSVP"}</button>
    );
  }
  // Coaching calls have no RSVP; Events offers them for Calendar instead.
  return (
    <button className="btn wk-act" title="Add to Calendar" onClick={async () => {
      const { ok } = await ch.files.addToCalendar(eventIcs(event), event.title);
      if (ok) setAdded(true);
    }}>{added ? <><Check />Added</> : <><CalendarPlus />Add</>}</button>
  );
}

function EventRow({ event, now }: { event: CommunityEvent; now: number }) {
  const start = new Date(event.startsAt);
  const live = isLive(event, now);
  const detail = event.organizer ?? (event.rsvpCount ? `${event.rsvpCount} going` : null);
  return (
    <div className="wk-row">
      <button className="wk-row-main" onClick={() => openEvent(event)}>
        <span className="wk-date"><small>{start.toLocaleDateString([], { weekday: "short" })}</small><b>{start.getDate()}</b></span>
        <span className="wk-text">
          <b>{event.title}</b>
          <small>
            {live ? <span className="wk-live">Live now</span> : `${clock(start)} ${zoneAbbrev(start)}`}
            {detail ? ` · ${detail}` : ""}
          </small>
        </span>
      </button>
      <Action event={event} now={now} />
    </div>
  );
}

function ThisWeek({ events, isLoading, calendarUnavailable, now }: { events: CommunityEvent[]; isLoading: boolean; calendarUnavailable: boolean; now: number }) {
  const week = events.filter((e) => now < endOf(e) && startOf(e) - now < 7 * DAY);
  // A quiet week still says what's coming: the next event after it.
  const next = week.length ? undefined : events.find((e) => startOf(e) > now);
  return (
    <section className="wk-card">
      <div className="wk-label">This week</div>
      {isLoading ? <div className="faint wk-empty">Loading events…</div> : null}
      {week.map((e) => <EventRow key={e.id} event={e} now={now} />)}
      {!isLoading && !week.length ? <div className="faint wk-empty">{next ? "Nothing scheduled this week." : "No events scheduled yet."}</div> : null}
      {next ? <><div className="wk-sublabel">Next up</div><EventRow event={next} now={now} /></> : null}
      {calendarUnavailable ? <div className="faint wk-note">Coaching calls are temporarily unavailable.</div> : null}
      <button className="wk-link" onClick={() => nav.open({ kind: "events" }, "home", "ch")}>See all events<ArrowRight /></button>
    </section>
  );
}

/* ---------- Your week ---------- */

function YourWeek() {
  const deals = useDeals();
  const points = usePoints();
  const list = allDeals(deals.data);
  const paid = paidThisWeek(list);
  const awaiting = smartDeals("awaiting", list);
  // No Hub on the member's plan (or it didn't load): the money tiles go, the streak stays.
  const hub = !deals.isError;
  const streak = points.data?.currentStreak ?? 0;
  if (!hub && !points.data) return null;
  return (
    <section className="wk-card">
      <div className="wk-label">Your week</div>
      {hub ? (
        <div className="wk-tiles">
          <button className="wk-tile" onClick={() => nav.open({ kind: "hub", page: "deals", smart: "paid" }, "hub", "ch")}>
            <b>{deals.data ? money(total(paid)) : "–"}</b><small>paid this week</small>
          </button>
          <button className="wk-tile" onClick={() => nav.open({ kind: "hub", page: "deals", smart: "awaiting" }, "hub", "ch")}>
            <b>{deals.data ? awaiting.length : "–"}</b><small>awaiting payment</small>
          </button>
        </div>
      ) : null}
      {points.data ? (
        <div className="wk-streak">
          <span className="wk-flame" aria-hidden="true">🔥</span>
          <span>
            <b>{streak > 0 ? `${streak}-day streak` : "No streak yet"}</b>
            <small>{streak > 0 ? "Log in tomorrow to keep it going" : "Log in each day to start one"}</small>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** The right-hand panel on Home. */
export function WeekPanel() {
  const { all, isLoading, isError, calendarUnavailable } = useEvents({ live: true });
  const now = useNow();
  const upcoming = useMemo(() => all.filter((e) => endOf(e) > now), [all, now]);
  return (
    <aside className="today-panel week-panel scroll">
      {/* Events closed on the member's plan: no banner, no This week. */}
      {isError ? null : <Banner events={upcoming} now={now} />}
      {isError ? null : <ThisWeek events={upcoming} isLoading={isLoading} calendarUnavailable={calendarUnavailable && !isLoading} now={now} />}
      <YourWeek />
    </aside>
  );
}
