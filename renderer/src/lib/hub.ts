import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "./api";

/*
  The Creator Hub's rules, exactly as the website has them (lib/hub/types.ts,
  lib/hub/constants.ts and components/hub/stage-colors.css on the website).
  Keep these in step with the website and the iPhone.
*/

export const DEAL_STATUSES = [
  "pitching", "deliverables_contract", "deal_secured",
  "waiting_product", "production", "post_production", "revisions",
  "delivered", "pending_payment", "case_study", "completed",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export type Board = "outreach" | "campaigns" | "payment";

export const BOARDS: Board[] = ["outreach", "campaigns", "payment"];
export const BOARD_STATUSES: Record<Board, DealStatus[]> = {
  outreach: ["pitching", "deliverables_contract", "deal_secured"],
  campaigns: ["waiting_product", "production", "post_production", "revisions"],
  payment: ["delivered", "pending_payment", "case_study", "completed"],
};
export const BOARD_LABELS: Record<Board, string> = { outreach: "Outreach", campaigns: "Campaigns", payment: "Payment" };

export const STATUS_LABELS: Record<DealStatus, string> = {
  pitching: "Pitching",
  deliverables_contract: "Deliverables / Contract",
  deal_secured: "Deal Secured",
  waiting_product: "Waiting on Product",
  production: "Production",
  post_production: "Post-Production",
  revisions: "Revisions",
  delivered: "Delivered",
  pending_payment: "Pending Payment",
  case_study: "Case Study / Testimonial",
  completed: "Completed",
};

export const MONEY_IN_PLAY_STATUSES: DealStatus[] = ["deal_secured", "waiting_product", "production", "post_production", "revisions", "delivered", "pending_payment", "case_study"];
export const POTENTIAL_STATUSES: DealStatus[] = ["pitching", "deliverables_contract"];
const DRAFT_PENDING = new Set<DealStatus>(["pitching", "deliverables_contract", "deal_secured", "waiting_product", "production", "post_production", "revisions"]);
export const isDraftPending = (s: DealStatus) => DRAFT_PENDING.has(s);

export const boardOf = (status: DealStatus): Board => BOARDS.find((b) => BOARD_STATUSES[b].includes(status)) ?? "outreach";
export function nextStatus(status: DealStatus): DealStatus | null {
  const i = DEAL_STATUSES.indexOf(status);
  return i >= 0 && i < DEAL_STATUSES.length - 1 ? DEAL_STATUSES[i + 1] : null;
}

export const DEAL_TYPES = [
  { id: "ugc", label: "UGC" }, { id: "tiktok_shop", label: "TikTok Shop" }, { id: "retainer", label: "Retainer" }, { id: "other", label: "Other" },
] as const;
export type DealType = (typeof DEAL_TYPES)[number]["id"];
export const dealTypeLabel = (id: string) => DEAL_TYPES.find((t) => t.id === id)?.label ?? "Other";

export interface Ref { id: string; label: string; custom: boolean }

export interface Deal {
  id: string;
  brand_name: string;
  deal_type: DealType;
  amount_usd: number;
  deliverables: string | null;
  notes: string | null;
  payment_method: string | null;
  payment_method_ref: Ref | null;
  contact_email: string | null;
  deal_sources: Ref[];
  industry_ref: Ref | null;
  draft_due_at: string | null;
  payment_expected_at: string | null;
  payment_terms_days: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  deliverables_count: number | null;
  status: DealStatus;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  added_by: { id: string; name: string; initials: string } | null;
  updated_by: { id: string; name: string; initials: string } | null;
}

export interface Payday {
  month_label: string;
  collected_before_usd: number;
  collected_after_usd: number;
  tier_before: string;
  tier_after: string;
  tier_name_after: string;
  tiered_up: boolean;
  tier_progress_percent_after: number;
}

export interface DealsResponse {
  outreach: Deal[];
  campaigns: Deal[];
  payment: Deal[];
  shared: boolean;
  members: { id: string; name: string; initials: string }[];
}

export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
export const withTz = (path: string) => `${path}${path.includes("?") ? "&" : "?"}tz=${encodeURIComponent(tz())}`;

/*
  Whose Hub the views read: the member's own (the default), or one student's
  for Admin → Hubs, which shows it read-only (views/admin/Hubs.tsx). `tz`
  pins the time zone, as the website's admin view does (America/Toronto).
*/
export interface HubSourceValue { base: string; key: readonly string[]; tz?: string }
export const HubSource = createContext<HubSourceValue>({ base: "/api/hub", key: ["hub"] });
export const useHubSource = () => useContext(HubSource);
export const sourcePath = (src: HubSourceValue, path: string) => {
  const full = `${src.base}${path}`;
  return `${full}${full.includes("?") ? "&" : "?"}tz=${encodeURIComponent(src.tz ?? tz())}`;
};

export function useDeals() {
  const src = useHubSource();
  return useQuery({ queryKey: [...src.key, "deals"], queryFn: () => api<DealsResponse>(sourcePath(src, "/deals")) });
}

export const allDeals = (data: DealsResponse | undefined) => (data ? [...data.outreach, ...data.campaigns, ...data.payment] : []);

export function useDeal(id: string | null) {
  const list = useDeals().data;
  const fromList = id ? allDeals(list).find((d) => d.id === id) : undefined;
  const single = useQuery({
    queryKey: ["hub", "deal", id],
    enabled: Boolean(id) && !fromList && Boolean(list),
    queryFn: async () => (await api<{ deal: Deal }>(withTz(`/api/hub/deals/${id}`))).deal,
  });
  return fromList ?? single.data;
}

export interface Tier {
  currentTier: string;
  collectedThisMonth: number;
  amountToNextTier: number | null;
  nextTier: string | null;
  topTierName: string;
  tierProgressPercent: number;
}

export interface Cash {
  tier: Tier;
  ladder: { key: string; name: string; minimum: number; unlocked: boolean; current: boolean }[];
  by_person: { id: string; name: string; initials: string; collected_usd: number }[];
  activity: { collected_this_month_usd: number; previous_month_collected_usd: number };
}

export function useCash() {
  const src = useHubSource();
  return useQuery({ queryKey: [...src.key, "cash"], queryFn: () => api<Cash>(sourcePath(src, "/cash?range=30")) });
}

/* ---------- Money ---------- */

const sum = (deals: Deal[]) => deals.reduce((total, d) => total + (d.amount_usd || 0), 0);
export const contracted = (deals: Deal[]) => deals.filter((d) => MONEY_IN_PLAY_STATUSES.includes(d.status));
export const potential = (deals: Deal[]) => deals.filter((d) => POTENTIAL_STATUSES.includes(d.status));
export const active = (deals: Deal[]) => deals.filter((d) => d.status !== "completed");
export const total = sum;

/* ---------- Dates (calendar days, no time zone) ---------- */

export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** A calendar day (YYYY-MM-DD) from either a day or a full timestamp, in local time. */
export function dayOf(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${dayOf(to)}T12:00:00`).getTime() - new Date(`${dayOf(from)}T12:00:00`).getTime()) / 86_400_000);
}
export const monDay = (value: string) => new Date(`${dayOf(value)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const monDayYear = (value: string) => new Date(`${dayOf(value)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ---------- Writes ---------- */

export async function refreshHub() {
  await queryClient.invalidateQueries({ queryKey: ["hub"] });
}

function replaceDeal(deal: Deal) {
  queryClient.setQueryData<DealsResponse>(["hub", "deals"], (data) => {
    if (!data) return data;
    const without = (list: Deal[]) => list.filter((d) => d.id !== deal.id);
    const next = { ...data, outreach: without(data.outreach), campaigns: without(data.campaigns), payment: without(data.payment) };
    const board = boardOf(deal.status);
    const before = allDeals(data).find((d) => d.id === deal.id);
    // Keep its place when it stays on the same board; otherwise it goes to the top, as the server orders.
    if (before && boardOf(before.status) === board) {
      next[board] = data[board].map((d) => (d.id === deal.id ? deal : d));
    } else {
      next[board] = [deal, ...next[board]];
    }
    return next;
  });
  queryClient.setQueryData(["hub", "deal", deal.id], deal);
}

export async function patchDeal(id: string, body: Record<string, unknown>) {
  const before = allDeals(queryClient.getQueryData<DealsResponse>(["hub", "deals"])).find((d) => d.id === id);
  if (before && typeof body.status === "string") replaceDeal({ ...before, ...(body as Partial<Deal>), status: body.status as DealStatus });
  try {
    const result = await api<{ deal: Deal; payday: Payday | null }>(withTz(`/api/hub/deals/${id}`), { method: "PATCH", body });
    replaceDeal(result.deal);
    void queryClient.invalidateQueries({ queryKey: ["hub"], predicate: (q) => q.queryKey[1] !== "deals" });
    return result;
  } catch (error) {
    if (before) replaceDeal(before);
    throw error;
  }
}

export async function createDeal(body: Record<string, unknown>) {
  const result = await api<{ deal: Deal; payday: Payday | null }>(withTz("/api/hub/deals"), { method: "POST", body });
  replaceDeal(result.deal);
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
  return result;
}

export async function deleteDeal(id: string) {
  await api(withTz(`/api/hub/deals/${id}`), { method: "DELETE" });
  queryClient.setQueryData<DealsResponse>(["hub", "deals"], (data) => data && ({
    ...data,
    outreach: data.outreach.filter((d) => d.id !== id),
    campaigns: data.campaigns.filter((d) => d.id !== id),
    payment: data.payment.filter((d) => d.id !== id),
  }));
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
}

/** The error the server gave, worded for a person. */
export function errorText(error: unknown) {
  const code = (error as { code?: string; message?: string })?.message ?? "";
  if (!code || code.startsWith("HTTP")) return "Something went wrong. Try again.";
  // The server's field codes ("invalid contact_email"), in words.
  const words: Record<string, string> = {
    "invalid contact_email": "That contact email doesn't look right.",
    "paid_on can't be in the future": "The paid date can't be in the future.",
    "invalid paid_on": "That paid date doesn't look right.",
  };
  if (words[code]) return words[code];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/* ---------- Pickers (default + custom sources, industries, payment methods) ---------- */

export interface Option { id: string; label: string; custom: boolean; dealCount?: number }

function useOptions(kind: "sources" | "industries" | "payment-methods", key: string) {
  return useQuery({
    queryKey: ["hub", "options", kind],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const data = await api<Record<string, unknown>>(`/api/hub/${kind}`);
      const custom = ((data[key] as { id: string; name: string; deal_count?: number }[]) ?? []).map((c) => ({ id: c.id, label: c.name, custom: true, dealCount: c.deal_count }));
      const defaults = ((data.defaults as { id: string; label: string }[]) ?? []).map((d) => ({ id: d.id, label: d.label, custom: false }));
      return [...defaults, ...custom] as Option[];
    },
  });
}
export const useSources = () => useOptions("sources", "sources");
export const useIndustries = () => useOptions("industries", "industries");
export const usePaymentMethods = () => useOptions("payment-methods", "payment_methods");

export type OptionKind = "sources" | "industries" | "payment-methods";

/** Rename one of the Hub's own sources, industries or payment methods; every deal using it shows the new name. */
export async function renameOption(kind: OptionKind, id: string, name: string) {
  await api(`/api/hub/${kind}/${id}`, { method: "PATCH", body: { name } });
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
}

/** Delete one; it comes off its deals and nothing else about them changes. */
export async function deleteOption(kind: OptionKind, id: string) {
  try {
    await api(`/api/hub/${kind}/${id}`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
}

export async function createOption(kind: "sources" | "industries" | "payment-methods", name: string): Promise<Option> {
  const objectKey = kind === "sources" ? "source" : kind === "industries" ? "industry" : "payment_method";
  try {
    const data = await api<Record<string, { id: string; name: string }>>(`/api/hub/${kind}`, { method: "POST", body: { name } });
    void queryClient.invalidateQueries({ queryKey: ["hub", "options", kind] });
    return { id: data[objectKey].id, label: data[objectKey].name, custom: true };
  } catch (error) {
    // Already there (yours, or one of the defaults): use that one.
    if (error instanceof ApiError && error.data) {
      const existing = error.data[objectKey] as { id: string; name: string } | undefined;
      if (existing) return { id: existing.id, label: existing.name, custom: true };
      if (typeof error.data.default_id === "string") return { id: error.data.default_id, label: name, custom: false };
    }
    throw error;
  }
}
