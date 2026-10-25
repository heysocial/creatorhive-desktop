import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, queryClient } from "./api";

/*
  Events come from two places on the server: community events (/api/events,
  with RSVPs) and the coaching calendars (/api/events/calendar: Office Hours
  and coaching calls, with Zoom links and Fathom recordings). The app shows
  them as one calendar.
*/

export interface CommunityEvent {
  id: string;
  source: "community" | "calendar";
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  joinUrl: string | null;
  rsvpd?: boolean;
  rsvpCount?: number;
  organizer?: string | null;
  recordingUrl?: string | null;
  summary?: string | null;
  tier?: string | null;
}

interface ApiEvent { id: string; title: string; description: string | null; locationUrl: string | null; startsAt: string; endsAt: string; rsvpd: boolean; rsvpCount: number }
interface CalendarEvent { id: string; title: string; description: string | null; startsAt: string; endsAt: string; joinUrl: string | null; recordingUrl: string | null; summary: string | null; organizer: string; tier: string }

export function useEvents() {
  const community = useQuery({
    queryKey: ["events", "community"],
    queryFn: async () => (await api<{ events: ApiEvent[] }>("/api/events?scope=all")).events,
  });
  // A failure stays a failure (not an empty list), so Events can say coaching calls are unavailable, as the website does.
  const calendar = useQuery({
    queryKey: ["events", "calendar"],
    retry: false,
    queryFn: async () => (await api<{ events: CalendarEvent[] }>("/api/events/calendar")).events,
  });
  const all = useMemo<CommunityEvent[]>(() => [
    ...(community.data ?? []).map((e) => ({
      id: e.id, source: "community" as const, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt,
      joinUrl: e.locationUrl, rsvpd: e.rsvpd, rsvpCount: e.rsvpCount,
    })),
    ...(calendar.data ?? []).map((e) => ({
      id: `cal:${e.id}`, source: "calendar" as const, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt,
      joinUrl: e.joinUrl, organizer: e.organizer, recordingUrl: e.recordingUrl, summary: e.summary, tier: e.tier,
    })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [community.data, calendar.data]);
  return { all, isLoading: community.isLoading, isError: community.isError && calendar.isError, calendarUnavailable: calendar.isError };
}

export async function toggleRsvp(event: CommunityEvent) {
  const result = await api<{ rsvpd: boolean; rsvpCount: number }>(`/api/events/${event.id}/rsvp`, { method: "POST" });
  queryClient.setQueryData<ApiEvent[]>(["events", "community"], (list) => list?.map((e) => (e.id === event.id ? { ...e, ...result } : e)));
  return result;
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** An .ics file for Calendar, with the Zoom link and a 10-minute alert. */
export function eventIcs(event: CommunityEvent) {
  const description = [event.joinUrl ? `Join: ${event.joinUrl}` : "", event.description ?? ""].filter(Boolean).join("\n\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CreatorHive//Mac//EN", "BEGIN:VEVENT",
    `UID:${event.id}@creatorhive`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(event.startsAt)}`, `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    description ? `DESCRIPTION:${icsText(description)}` : "",
    event.joinUrl ? `URL:${event.joinUrl}` : "",
    event.joinUrl ? `LOCATION:${icsText(event.joinUrl)}` : "",
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${icsText(event.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

/** "Zoom", "Google Meet", ... for the join button. */
export function meetingName(url: string | null) {
  if (!url) return "meeting";
  if (/zoom\./i.test(url)) return "Zoom meeting";
  if (/meet\.google/i.test(url)) return "Google Meet";
  if (/teams\./i.test(url)) return "Teams meeting";
  return "meeting";
}
