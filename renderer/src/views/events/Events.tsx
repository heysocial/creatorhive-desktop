import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, PlayCircle, Radio, User, Video } from "lucide-react";
import { ch } from "../../lib/bridge";
import { eventIcs, meetingName, toggleRsvp, useEvents, type CommunityEvent } from "../../lib/events";
import { clock, fullDate } from "../../lib/format";
import { RichText } from "../../lib/html";
import { nav } from "../../lib/nav";
import { EventStaffActions, NewEventButton } from "./EventAdmin";

type Mode = "day" | "week" | "month" | "list";
const HOUR_PX = 64;
const DAY_MS = 86_400_000;

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7; // Monday first, as in the mockup
  d.setDate(d.getDate() - day);
  return d;
}
const addDays = (date: Date, n: number) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

const COLORS = ["blue", "green", "purple", "pink", "orange"];
function colorFor(event: CommunityEvent) {
  if (event.source === "community") return "honey";
  let hash = 0;
  for (const c of event.organizer ?? event.title) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function timeRange(event: CommunityEvent) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return `${start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${clock(start)} – ${clock(end)}`;
}

function startsLabel(event: CommunityEvent) {
  const start = new Date(event.startsAt);
  const now = new Date();
  if (now >= start && now < new Date(event.endsAt)) return "Live now";
  if (sameDay(start, now)) return "Starts today";
  if (sameDay(start, addDays(now, 1))) return "Starts tomorrow";
  if (start.getTime() - now.getTime() < 7 * DAY_MS && start > now) return `Starts ${start.toLocaleDateString([], { weekday: "long" })}`;
  return start < now ? "Past" : `Starts ${start.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function Detail({ event, past, onDeleted }: { event: CommunityEvent | undefined; past: CommunityEvent[]; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => setAdded(false), [event?.id]);
  if (!event) {
    return (
      <aside className="ev-detail">
        <p className="muted">Pick an event to see the details.</p>
        <PastList past={past} />
      </aside>
    );
  }
  const ended = new Date(event.endsAt) < new Date();
  return (
    <aside className="ev-detail scroll">
      <span className={`ev-when ${startsLabel(event) === "Live now" ? "live" : ""}`}><Radio />{startsLabel(event)}</span>
      <h2>{event.title}</h2>
      <div className="ev-line"><Clock />{timeRange(event)}</div>
      {event.organizer ? <div className="ev-line"><User />Hosted by {event.organizer}</div> : null}
      {!ended ? (
        <button className="btn zoom lg" disabled={!event.joinUrl} onClick={() => event.joinUrl && ch.app.openExternal(event.joinUrl)}>
          <Video />{event.joinUrl ? `Join ${meetingName(event.joinUrl)}` : "Join Zoom meeting · link coming soon"}
        </button>
      ) : null}
      {ended && !event.recordingUrl && event.source === "calendar" ? <div className="muted">No recording for this call</div> : null}
      {ended && event.recordingUrl ? <button className="btn lg" onClick={() => ch.app.openExternal(event.recordingUrl!)}><PlayCircle />Watch recording</button> : null}
      {event.source === "community" && event.rsvpCount ? <div className="muted">{event.rsvpCount} going</div> : null}
      <div className="ev-actions">
        {event.source === "community" && !ended ? (
          <button className={`btn ${event.rsvpd ? "honey" : ""}`} disabled={busy} onClick={async () => {
            setBusy(true);
            try { await toggleRsvp(event); } catch { window.alert("Couldn't save your RSVP."); } finally { setBusy(false); }
          }}>{event.rsvpd ? <><Check />Going</> : "I'm going"}</button>
        ) : null}
        {!ended ? (
          <button className="btn" onClick={async () => {
            const { ok } = await ch.files.addToCalendar(eventIcs(event), event.title);
            if (ok) setAdded(true);
          }}><CalendarPlus />{added ? "Sent to Calendar" : "Add to Calendar"}</button>
        ) : null}
      </div>
      {!ended ? (
        <div className="ev-note"><span className="t-ico honey"><Bell /></span><span><b>Reminder 10 min before</b><small>From Calendar once added, and a Mac notification from CreatorHive</small></span></div>
      ) : null}
      <EventStaffActions key={event.id} event={event} onDeleted={onDeleted} />
      {event.summary ? <div className="ev-summary"><div className="section-label">Fathom summary</div><RichText text={event.summary} /></div> : null}
      {event.description ? <div className="ev-desc"><RichText text={event.description.replace(/<[^>]+>/g, " ")} /></div> : null}
      <PastList past={past} />
    </aside>
  );
}

function PastList({ past }: { past: CommunityEvent[] }) {
  const recorded = past.filter((e) => e.recordingUrl).slice(0, 5);
  if (!recorded.length) return null;
  return (
    <div className="ev-past">
      <div className="section-label">Past · with Fathom summary</div>
      {recorded.map((e) => (
        <button key={e.id} className="t-card" onClick={() => ch.app.openExternal(e.recordingUrl!)}>
          <span className="t-ico"><PlayCircle /></span>
          <span><b>{e.title}</b><small>{new Date(e.startsAt).toLocaleDateString([], { month: "short", day: "numeric" })} · Watch recording</small></span>
        </button>
      ))}
    </div>
  );
}

function TimeGrid({ days, events, selected, onSelect }: { days: Date[]; events: CommunityEvent[]; selected?: string; onSelect: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // Open at 8 AM, or an hour before now.
    const hour = Math.max(0, Math.min(new Date().getHours() - 1, 8));
    scroller.current?.scrollTo({ top: hour * HOUR_PX });
  }, [days[0]?.getTime()]);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="tg">
      <div className="tg-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <span key={d.toISOString()} className={sameDay(d, now) ? "today" : ""}>
            <small>{d.toLocaleDateString([], { weekday: "short" })}</small><b>{d.getDate()}</b>
          </span>
        ))}
      </div>
      <div className="tg-body scroll" ref={scroller}>
        <div className="tg-grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, height: HOUR_PX * 24 }}>
          <div className="tg-hours">{hours.map((h) => <span key={h} style={{ top: h * HOUR_PX }}>{h === 0 ? "" : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}</span>)}</div>
          {days.map((day) => {
            const dayEvents = events.filter((e) => sameDay(new Date(e.startsAt), day));
            return (
              <div key={day.toISOString()} className="tg-col">
                {hours.map((h) => <i key={h} style={{ top: h * HOUR_PX }} />)}
                {sameDay(day, now) ? <div className="now-line" style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR_PX }} /> : null}
                {dayEvents.map((e) => {
                  const start = new Date(e.startsAt);
                  const minutes = Math.max(30, (new Date(e.endsAt).getTime() - start.getTime()) / 60_000);
                  return (
                    <button key={e.id} className={`ev ${colorFor(e)} ${selected === e.id ? "sel" : ""}`}
                      style={{ top: (start.getHours() + start.getMinutes() / 60) * HOUR_PX + 1, height: (minutes / 60) * HOUR_PX - 3 }}
                      onClick={() => onSelect(e.id)}>
                      <b>{e.title}</b><span>{clock(start)}{e.organizer ? ` · ${e.organizer}` : ""}{e.rsvpCount ? ` · ${e.rsvpCount} going` : ""}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ anchor, events, selected, onSelect }: { anchor: Date; events: CommunityEvent[]; selected?: string; onSelect: (id: string) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();
  return (
    <div className="mg">
      <div className="mg-head">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="mg-grid">
        {cells.map((day) => {
          const dayEvents = events.filter((e) => sameDay(new Date(e.startsAt), day));
          return (
            <div key={day.toISOString()} className={`mg-cell ${day.getMonth() !== anchor.getMonth() ? "out" : ""} ${sameDay(day, today) ? "today" : ""}`}>
              <span className="d">{day.getDate()}</span>
              {dayEvents.slice(0, 3).map((e) => (
                <button key={e.id} className={`mg-ev ${colorFor(e)} ${selected === e.id ? "sel" : ""}`} onClick={() => onSelect(e.id)}>{clock(e.startsAt)} {e.title}</button>
              ))}
              {dayEvents.length > 3 ? <span className="faint more">+{dayEvents.length - 3} more</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ events, selected, onSelect }: { events: CommunityEvent[]; selected?: string; onSelect: (id: string) => void }) {
  const upcoming = events.filter((e) => new Date(e.endsAt) >= new Date());
  let lastDay = "";
  return (
    <div className="ev-list scroll">
      {upcoming.length === 0 ? <div className="empty-state">No upcoming events.</div> : null}
      {upcoming.map((e) => {
        const day = new Date(e.startsAt).toDateString();
        const header = day !== lastDay;
        lastDay = day;
        return (
          <div key={e.id}>
            {header ? <div className="day"><span>{fullDate(e.startsAt).split(" at ")[0].replace(/, \d{4}$/, "")}</span></div> : null}
            <button className={`ev-row ${selected === e.id ? "sel" : ""}`} onClick={() => onSelect(e.id)}>
              <span className={`swatch ${colorFor(e)}`} />
              <span className="t">{clock(e.startsAt)} – {clock(e.endsAt)}</span>
              <b>{e.title}</b>
              <span className="faint">{e.organizer ?? (e.rsvpCount ? `${e.rsvpCount} going` : "")}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Events({ eventId }: { eventId?: string }) {
  const { all, isLoading, isError, calendarUnavailable } = useEvents();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("ch.events.mode") as Mode) || "week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState<string | undefined>(eventId);

  useEffect(() => {
    try { localStorage.setItem("ch.events.mode", mode); } catch { /* fine */ }
  }, [mode]);

  // Default selection: the given event, else the next one.
  useEffect(() => {
    if (eventId) {
      setSelected(eventId);
      const event = all.find((e) => e.id === eventId);
      if (event) setAnchor(new Date(event.startsAt));
      return;
    }
    if (!selected && all.length) {
      const next = all.find((e) => new Date(e.endsAt) >= new Date());
      if (next) setSelected(next.id);
    }
  }, [eventId, all.length]);

  const days = useMemo(() => {
    if (mode === "day") return [startOfDay(anchor)];
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [mode, anchor]);

  const step = (direction: 1 | -1) => {
    if (mode === "day") setAnchor(addDays(anchor, direction));
    else if (mode === "month") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
    else setAnchor(addDays(anchor, 7 * direction));
  };

  const event = all.find((e) => e.id === selected);
  const past = useMemo(() => all.filter((e) => new Date(e.endsAt) < new Date()).reverse(), [all]);

  return (
    <div className="page events">
      <div className="mhead">
        <h1>Events</h1>
        <span className="sub">{anchor.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
        <div className="acts">
          <div className="seg">
            {(["day", "week", "month", "list"] as Mode[]).map((m) => <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
          </div>
          <button className="btn" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="iconbtn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft /></button>
          <button className="iconbtn" aria-label="Next" onClick={() => step(1)}><ChevronRight /></button>
          <NewEventButton onCreated={(created) => { setSelected(created.id); setAnchor(new Date(created.startsAt)); }} />
        </div>
      </div>
      <div className="ev-body">
        <div className="ev-main">
          {calendarUnavailable && !isError ? <div className="ev-notice"><Video />Coaching calls are temporarily unavailable. Community events are still available.</div> : null}
          {isLoading ? <div className="empty-state">Loading events…</div> : isError ? <div className="empty-state">Couldn't load events.</div> : (
            mode === "month" ? <MonthGrid anchor={anchor} events={all} selected={selected} onSelect={setSelected} />
              : mode === "list" ? <ListView events={all} selected={selected} onSelect={setSelected} />
              : <TimeGrid days={days} events={all} selected={selected} onSelect={setSelected} />
          )}
        </div>
        <Detail event={event} past={past} onDeleted={() => setSelected(undefined)} />
      </div>
    </div>
  );
}

/** The sidebar's hint: the weekday of the next event. */
export function useNextEventDay() {
  const { all } = useEvents();
  const next = all.find((e) => new Date(e.endsAt) >= new Date() && new Date(e.startsAt).getTime() - Date.now() < 7 * DAY_MS);
  if (!next) return undefined;
  const start = new Date(next.startsAt);
  return sameDay(start, new Date()) ? clock(start) : start.toLocaleDateString([], { weekday: "short" });
}

export const openEvent = (id: string) => nav.open({ kind: "events", eventId: id }, "home", "ch");
