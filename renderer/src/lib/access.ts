import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

/*
  The member's plan, from the website (GET /api/me/access). The server
  enforces every lock; this decides what the app offers. Today that is the
  Creator Hub: The Weekend Starter (first3) has none, so its rail item, its
  views and every Hub request wait until the plan is known and has it.

  Same query key and shape as Courses' upgrade link, so they share one fetch.
*/

export interface MeAccess {
  state: "academy" | "starter" | "starter_ended" | "guest";
  plan?: "academy" | "starter" | "first3" | "guest";
  /** The areas the plan locks: "hub" on The Weekend Starter (servers from Nov 9 2026). */
  locked: string[];
  upgradeUrl: string | null;
  /** The feed categories a limited plan reads (null: every category). */
  feedCategories?: string[] | null;
  /** It may write nowhere in the feed. */
  feedReadOnly?: boolean;
  /** In the Weekend Starter group (its buyers and the team): its tab shows. Servers from Nov 10 2026. */
  weekendGroup?: boolean;
  /** The categories it may post, comment and react in (null: every one it reads). */
  feedWritable?: string[] | null;
  /** The tab the feed opens on: "weekend_starter" on The Weekend Starter. */
  feedHome?: string | null;
  /** When The Weekend Starter's 30 days end (or ended). */
  communityEndsAt?: string | null;
  /** Who a limited plan may start a DM with (see useStarterContacts). */
  starterContacts?: StarterContact[];
}

export function useMeAccess() {
  return useQuery({
    queryKey: ["me", "access"],
    staleTime: 300_000,
    queryFn: () => api<{ access: MeAccess }>("/api/me/access"),
  });
}

/** `known`: the plan has been read, or reading it failed (then everything is offered, as before). */
export function useHubAccess(): { known: boolean; open: boolean } {
  const access = useMeAccess();
  const known = access.isSuccess || access.isError;
  const locked = access.data?.access?.locked;
  return { known, open: !(Array.isArray(locked) && locked.includes("hub")) };
}

/** The Hub's data may be asked for: the plan is known and includes it. */
export function useHubReady(): boolean {
  const { known, open } = useHubAccess();
  return known && open;
}

/** The Hub is not offered: the plan is known and has no Hub (The Weekend Starter). */
export function useHubHidden(): boolean {
  const { known, open } = useHubAccess();
  return known && !open;
}

export const WEEKEND_STARTER = "weekend_starter";

/**
 * The feed's locks, from the website's rules (creatorhive-app lib/access.ts):
 * UGC Starter reads Wins; The Weekend Starter reads its group (writing in it
 * for its 30 days) and Wins; only the group and the team see the group. The
 * server refuses the rest anyway; this decides tabs, the composer and buttons.
 * Until the plan is read, nothing is locked (as before).
 */
export function useFeedAccess() {
  const access = useMeAccess().data?.access;
  const list = access?.feedCategories;
  const limited = Array.isArray(list);
  const group = access?.weekendGroup === true;
  const canRead = (category: string) => (limited ? list.includes(category) : category !== WEEKEND_STARTER || group);
  const writable = access?.feedWritable;
  const canWrite = (category: string) => {
    if (!canRead(category)) return false;
    if (Array.isArray(writable)) return writable.includes(category);
    return access?.feedReadOnly !== true;
  };
  return {
    limited,
    group,
    canRead,
    canWrite,
    home: access?.feedHome ?? (limited ? list[0] ?? "win" : "all"),
    /** The group became read-only: its 30 days are over. */
    groupEnded: limited && group && !canWrite(WEEKEND_STARTER),
    endsAt: access?.communityEndsAt ?? null,
  };
}

/** Opens "Part of the UGC Academy" over Home (it listens for this). */
export function openUpgrade() {
  window.dispatchEvent(new Event("ch:upgrade"));
}

/** Someone a limited plan can start a DM with (GET /api/me/access → starterContacts). */
export interface StarterContact {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** "Video editor": The Weekend Starter's contacts have one (servers from Nov 10 2026). */
  title?: string | null;
}

/**
 * Who a limited plan may start a DM with, pinned at the top of its DMs:
 * Vince on UGC Starter; Vince, Simon and Valentin on The Weekend Starter.
 * Empty for everyone else (the Academy messages anyone).
 */
export function useStarterContacts(): StarterContact[] {
  const access = useMeAccess().data?.access as (MeAccess & { starterContacts?: StarterContact[] }) | undefined;
  if (!access || access.state !== "starter") return [];
  return Array.isArray(access.starterContacts) ? access.starterContacts : [];
}

/** "Valentin · Video editor" when the contact has a title, else their name. */
export function contactLabel(contact: StarterContact): string {
  const first = contact.name.split(" ")[0] || contact.name;
  return contact.title ? `${first} · ${contact.title}` : contact.name;
}
