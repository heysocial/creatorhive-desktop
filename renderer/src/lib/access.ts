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
