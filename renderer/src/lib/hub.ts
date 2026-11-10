import { createContext, useContext } from "react";
import { useHubReady } from "./access";
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
  "delivered", "pending_payment", "case_study", "completed", "closed_unpaid", "closed_not_contracted",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export type Board = "outreach" | "campaigns" | "payment";

export const BOARDS: Board[] = ["outreach", "campaigns", "payment"];
export const BOARD_STATUSES: Record<Board, DealStatus[]> = {
  outreach: ["pitching", "deliverables_contract", "deal_secured"],
  campaigns: ["waiting_product", "production", "post_production", "revisions"],
  // The two closed stages close the Payment board out: Closed – Unpaid, a deal that ended without the money, and Closed – Not
  // contracted, one that fell through in negotiation. Neither is ever a "next" stage; each is chosen on purpose.
  payment: ["delivered", "pending_payment", "case_study", "completed", "closed_unpaid", "closed_not_contracted"],
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
  closed_unpaid: "Closed – Unpaid",
  closed_not_contracted: "Closed – Not contracted",
};

/*
  Closed – Unpaid (Tara's Roadmap card): the brand declined, or it stayed
  pending so long she stopped counting on it. The deal keeps its amount and
  counts toward nothing: not active, Contracted, Potential, collected, tiers
  or streaks, and it's never stale or overdue.
*/
export type UnpaidReason = "declined" | "unresolved";
export const UNPAID_REASON_LABELS: Record<UnpaidReason, string> = { declined: "Declined", unresolved: "Unresolved / still pending" };
/*
  Closed – Not contracted (Tara's follow-up, Nov 3) is its twin for a deal
  that fell through in negotiation: no reason, an optional note, and a total
  of its own ("Fell through"), never added to Didn't pay out.
*/
export const CLOSED_OUT_STATUSES = ["closed_unpaid", "closed_not_contracted"] as const satisfies readonly DealStatus[];
export type ClosedOutStatus = (typeof CLOSED_OUT_STATUSES)[number];
/** Closed – Unpaid or Closed – Not contracted: kept, counted in no total. */
export const isClosedOutStatus = (s: DealStatus): s is ClosedOutStatus => (CLOSED_OUT_STATUSES as readonly DealStatus[]).includes(s);
/** What each closed-out stage's own total is called, on the overview, the Dashboard and the lane. */
export const CLOSED_OUT_TOTAL_LABELS: Record<ClosedOutStatus, string> = { closed_unpaid: "Didn't pay out", closed_not_contracted: "Fell through" };
/** The hint under each in the stage menu. */
export const CLOSED_OUT_HINTS: Record<ClosedOutStatus, string> = { closed_unpaid: "Ended without being paid", closed_not_contracted: "Fell through before a contract" };
/** The stages a deal advances through, in order: every one but the closed-out ones. */
export const ADVANCE_STATUSES: DealStatus[] = DEAL_STATUSES.filter((s) => !isClosedOutStatus(s));
/** Finished: paid, or closed out without pay. None is open work. */
export const isClosedStatus = (s: DealStatus) => s === "completed" || isClosedOutStatus(s);
export const isActiveDeal = (s: DealStatus) => !isClosedStatus(s);

export const MONEY_IN_PLAY_STATUSES: DealStatus[] = ["deal_secured", "waiting_product", "production", "post_production", "revisions", "delivered", "pending_payment", "case_study"];
export const POTENTIAL_STATUSES: DealStatus[] = ["pitching", "deliverables_contract"];
const DRAFT_PENDING = new Set<DealStatus>(["pitching", "deliverables_contract", "deal_secured", "waiting_product", "production", "post_production", "revisions"]);
export const isDraftPending = (s: DealStatus) => DRAFT_PENDING.has(s);
/** Delivered or later: the stages a deal can have a "Delivered on" day. Not Closed – Not contracted: nothing was delivered. */
export const DELIVERED_STATUSES: DealStatus[] = ["delivered", "pending_payment", "case_study", "completed", "closed_unpaid"];
export const isDeliveredOrLater = (s: DealStatus) => DELIVERED_STATUSES.includes(s);

export const boardOf = (status: DealStatus): Board => BOARDS.find((b) => BOARD_STATUSES[b].includes(status)) ?? "outreach";
/** The stage after this one; none after Completed, and none into or out of the closed-out stages. */
export function nextStatus(status: DealStatus): DealStatus | null {
  const i = ADVANCE_STATUSES.indexOf(status);
  return i >= 0 && i < ADVANCE_STATUSES.length - 1 ? ADVANCE_STATUSES[i + 1] : null;
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
  /* The paid day in the member's zone, and the same day while it's still ahead ("Lands Nov 4"). Completed deals only; older servers leave them out. */
  paid_on?: string | null;
  lands_on?: string | null;
  /* The day it was delivered, its last stage change, and what the server works out from them (lib/hub/timing.ts on the website). Older servers leave them out. */
  delivered_at?: string | null;
  stage_changed_at?: string;
  stale_days?: number | null;
  unpaid_days?: number | null;
  payment_overdue?: boolean;
  /* The closed-out stages: why (Closed – Unpaid only), an optional note, and when it closed. Older servers leave them out. */
  unpaid_reason?: UnpaidReason | null;
  unpaid_note?: string | null;
  closed_unpaid_at?: string | null;
  created_at: string;
  updated_at: string;
  added_by: { id: string; name: string; initials: string } | null;
  updated_by: { id: string; name: string; initials: string } | null;
  /*
    Retainers (the website's hand-off §11.2): one deal paid again and again,
    each payment logged inside it. For a retainer `amount_usd` is one payment.
    Older servers leave these out, and every deal is then a one-time deal.
  */
  payment_kind?: "one_time" | "retainer";
  retainer?: Retainer | null;
  /** What the expenses linked to this deal add up to, in cents ("Costs $180 · you kept $1,320"). */
  costs_cents?: number;
}

export type RetainerInterval = "week" | "two_weeks" | "month";
export interface RetainerPayment {
  id: string;
  amount_usd: number;
  paid_at: string;
  /** The paid day in the member's zone. */
  paid_on: string;
  /** False while the day is still ahead. */
  landed: boolean;
  payment_method: string | null;
  payment_method_ref: Ref | null;
  note: string | null;
}
export interface Retainer {
  interval: RetainerInterval;
  amount_usd: number;
  anchor_on: string;
  ended_on: string | null;
  /** "/week". */
  per_label: string;
  /** "every week". */
  every_label: string;
  monthly_estimate_usd: number;
  next_due_on: string | null;
  upcoming: string[];
  missed: string[];
  paid_count: number;
  paid_total_usd: number;
  /** Newest first. */
  payments: RetainerPayment[];
}
export const isRetainer = (deal: Deal): deal is Deal & { retainer: Retainer } => deal.payment_kind === "retainer" && Boolean(deal.retainer);
export const RETAINER_INTERVALS: { id: RetainerInterval; label: string }[] = [
  { id: "week", label: "Every week" }, { id: "two_weeks", label: "Every 2 weeks" }, { id: "month", label: "Every month" },
];
/** "About $1,083 a month": week × 52 / 12, two weeks × 26 / 12. */
export const retainerMonthly = (amount: number, interval: RetainerInterval) => interval === "week" ? Math.round((amount * 52) / 12) : interval === "two_weeks" ? Math.round((amount * 26) / 12) : amount;
export const retainerYearly = (amount: number, interval: RetainerInterval) => interval === "week" ? amount * 52 : interval === "two_weeks" ? amount * 26 : amount * 12;

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
  // Not before the plan is known, and never on a plan without the Hub (The Weekend Starter).
  const enabled = useHubReady();
  return useQuery({ queryKey: [...src.key, "deals"], queryFn: () => api<DealsResponse>(sourcePath(src, "/deals")), enabled });
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

export interface ClosedUnpaidSummary {
  since: string;
  count: number;
  amount_usd: number;
  declined: { count: number; amount_usd: number };
  unresolved: { count: number; amount_usd: number };
}

/** Closed – Not contracted this calendar year: its own figure, never added to Didn't pay out. */
export interface ClosedOutSummary {
  since: string;
  count: number;
  amount_usd: number;
}

export interface Cash {
  tier: Tier;
  ladder: { key: string; name: string; minimum: number; unlocked: boolean; current: boolean }[];
  by_person: { id: string; name: string; initials: string; collected_usd: number }[];
  activity: {
    collected_this_month_usd: number;
    previous_month_collected_usd: number;
    /* Marked paid for a day still ahead, soonest first. Older servers leave it out. */
    landing?: { id: string; brand_name: string; amount_usd: number; lands_on: string }[];
    /* Closed – Unpaid this calendar year, by reason; in no other figure. Older servers leave it out. */
    closed_unpaid?: ClosedUnpaidSummary;
    /* Closed – Not contracted this calendar year; in no other figure, Didn't pay out included. Older servers leave it out. */
    closed_not_contracted?: ClosedOutSummary;
  };
}

export function useCash() {
  const src = useHubSource();
  const enabled = useHubReady();
  return useQuery({ queryKey: [...src.key, "cash"], queryFn: () => api<Cash>(sourcePath(src, "/cash?range=30")), enabled });
}

/* ---------- Money ---------- */

const sum = (deals: Deal[]) => deals.reduce((total, d) => total + (d.amount_usd || 0), 0);
/* Secured and not collected yet: a money-in-play stage, or paid for a day still ahead. */
export const contracted = (deals: Deal[]) => deals.filter((d) => MONEY_IN_PLAY_STATUSES.includes(d.status) || isLanding(d));
export const potential = (deals: Deal[]) => deals.filter((d) => POTENTIAL_STATUSES.includes(d.status));
export const active = (deals: Deal[]) => deals.filter((d) => isActiveDeal(d.status));
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

/** "Oct 20", with the year only when it isn't this one ("Oct 20, 2025"). */
export const shortDay = (value: string) => (dayOf(value).slice(0, 4) === localToday().slice(0, 4) ? monDay(value) : monDayYear(value));

/* ---------- Landing: paid for a day still ahead (the website's lib/hub/landing.ts) ---------- */

/*
  Linda's request (Nov 1): a deal can be marked paid on a day still ahead, the
  day the money reaches the bank. Until then it shows "Lands Nov 4" and counts
  as Contracted, not collected. The server says so in `lands_on`; a server
  without it, or a deal from a list that leaves it out, falls back on the
  website's rule: an entered day is stored as noon, so the day has started
  once paid_at is no more than 12 hours ahead.
*/
const LANDING_GRACE_MS = 12 * 3_600_000;
/** The furthest ahead a paid day may be (the server's limit). */
export const MAX_PAID_DAYS_AHEAD = 366;

/** The day the money lands while that's still ahead, else null. */
export function landsOn(deal: { status: string; paid_at: string | null; lands_on?: string | null }) {
  // The server's answer, until its day comes round while the list is still on screen.
  if (deal.lands_on !== undefined) return deal.lands_on && deal.lands_on > localToday() ? deal.lands_on : null;
  if (deal.status !== "completed" || !deal.paid_at) return null;
  const at = Date.parse(deal.paid_at);
  return Number.isFinite(at) && at > Date.now() + LANDING_GRACE_MS ? dayOf(deal.paid_at) : null;
}
export const isLanding = (deal: Deal) => landsOn(deal) !== null;
/** Paid and landed: what a collected figure counts. */
export const isCollected = (deal: Deal) => deal.payment_kind !== "retainer" && deal.status === "completed" && Boolean(deal.paid_at) && !isLanding(deal);
/** "Lands Nov 4", with the year only when it isn't this one. */
export const landsLabel = (day: string) => `Lands ${shortDay(day)}`;
/** "Mon, Nov 16". */
export const weekdayDay = (day: string) => new Date(`${dayOf(day)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** "Wednesday, Nov 4". */
export const longDay = (day: string) => new Date(`${dayOf(day)}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

/* ---------- Timing words (the website's lib/hub/timing.ts; the server counts the days) ---------- */

/** "Delivered today" / "Delivered yesterday" / "Delivered 9 days ago". */
export const deliveredAgo = (days: number) => (days <= 0 ? "Delivered today" : days === 1 ? "Delivered yesterday" : `Delivered ${days} days ago`);
export const unpaidText = (days: number) => `${deliveredAgo(days)} · not paid yet`;
export const staleText = (days: number) => `No stage change in ${days} ${days === 1 ? "day" : "days"}`;

/** "Declined · closed Oct 28", or "Fell through · closed Nov 3" for Closed – Not contracted. */
export function closedUnpaidLine(deal: Deal) {
  const reason = deal.status === "closed_not_contracted" ? "Fell through" : deal.unpaid_reason === "declined" ? "Declined" : "Unresolved";
  return deal.closed_unpaid_at ? `${reason} · closed ${shortDay(deal.closed_unpaid_at)}` : reason;
}

/** A card's one timing line: unpaid since delivery (maybe overdue), else the delivered day, else why it's stale. */
export function timingLine(deal: Deal): { text: string; overdue: boolean } | null {
  // Finished without the money: never stale or overdue, whatever an older server says.
  if (isClosedOutStatus(deal.status)) return null;
  if (deal.unpaid_days != null) return { text: unpaidText(deal.unpaid_days), overdue: Boolean(deal.payment_overdue) };
  if (deal.delivered_at) return { text: `Delivered ${shortDay(deal.delivered_at)}`, overdue: false };
  if (deal.stale_days != null) return { text: staleText(deal.stale_days), overdue: false };
  return null;
}

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

/* ---------- Retainer payments (the website's /api/hub/deals/[id]/payments) ---------- */

export async function logPayment(dealId: string, body: { amount_usd: number; paid_on: string; payment_method_ref?: string | null; note?: string | null }) {
  const result = await api<{ deal: Deal | null; payday: Payday | null }>(withTz(`/api/hub/deals/${dealId}/payments`), { method: "POST", body });
  if (result.deal) replaceDeal(result.deal);
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
  return result;
}

export async function removePayment(dealId: string, paymentId: string) {
  const result = await api<{ deal: Deal | null }>(withTz(`/api/hub/deals/${dealId}/payments/${paymentId}`), { method: "DELETE" });
  if (result.deal) replaceDeal(result.deal);
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
}

export async function endRetainer(dealId: string, lastPaymentOn: string) {
  const result = await api<{ deal: Deal }>(withTz(`/api/hub/deals/${dealId}/retainer/end`), { method: "POST", body: { last_payment_on: lastPaymentOn } });
  replaceDeal(result.deal);
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
}

/* ---------- Money in & out (the website's lib/hub/money.ts) ---------- */

export type ExpenseCategory = "editor" | "va" | "software" | "equipment" | "other";
export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; short: string; stage: string }[] = [
  { id: "editor", label: "Editor", short: "Editor", stage: "production" },
  { id: "va", label: "VA (virtual assistant)", short: "VA", stage: "delivered" },
  { id: "software", label: "Software & subscriptions", short: "Software", stage: "waiting_product" },
  { id: "equipment", label: "Equipment", short: "Equipment", stage: "revisions" },
  { id: "other", label: "Other", short: "Other", stage: "pitching" },
];
export const categoryOf = (id: string) => EXPENSE_CATEGORIES.find((c) => c.id === id) ?? EXPENSE_CATEGORIES[4];

export interface MoneySummary {
  period: "month" | "year";
  from: string;
  to: string;
  label: string;
  in_cents: number;
  out_cents: number;
  left_cents: number;
  counts: { payments: number; from_retainers: number; expenses: number };
  expected_in_cents: number | null;
  to_renew_cents: number;
  by_category: { category: ExpenseCategory; label: string; count: number; cents: number }[];
}
export interface Expense {
  id: string; name: string; amount_cents: number; category: ExpenseCategory; category_label: string;
  spent_on: string; deal_id: string | null; deal_brand_name: string | null; subscription_id: string | null;
  receipt_url: string | null; note: string | null;
}
export interface Subscription {
  id: string; name: string; amount_cents: number; category: ExpenseCategory; renews_day: number;
  started_on: string; canceled_on: string | null; remind_day_before: boolean; next_renewal_on: string | null;
}

/** "$1,234.56", from cents. */
export const cents = (value: number) => `${value < 0 ? "−" : ""}$${(Math.abs(value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function useMoney() {
  const src = useHubSource();
  const enabled = useHubReady() && src.base === "/api/hub";
  return useQuery({ queryKey: ["hub", "money"], enabled, queryFn: () => api<{ today: string; month: MoneySummary; year: MoneySummary; show_money_out: boolean }>(withTz("/api/hub/money")) });
}
export function useExpenses(from: string, to: string) {
  const enabled = useHubReady() && useHubSource().base === "/api/hub";
  return useQuery({ queryKey: ["hub", "expenses", from, to], enabled, queryFn: async () => (await api<{ expenses: Expense[] }>(withTz(`/api/hub/expenses?from=${from}&to=${to}`))).expenses });
}
export function useSubscriptions() {
  const enabled = useHubReady() && useHubSource().base === "/api/hub";
  return useQuery({ queryKey: ["hub", "subscriptions"], enabled, queryFn: () => api<{ subscriptions: Subscription[]; monthly_cents: number; yearly_cents: number }>(withTz("/api/hub/subscriptions")) });
}
export async function moneyWrite(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const result = await api<Record<string, unknown>>(withTz(path), { method, ...(body ? { body } : {}) });
  void queryClient.invalidateQueries({ queryKey: ["hub"] });
  return result;
}
export async function saveShowMoneyOut(value: boolean) {
  await api("/api/hub/money/preferences", { method: "PATCH", body: { show_money_out: value } });
  queryClient.setQueryData<{ show_money_out: boolean }>(["hub", "money"], (data) => data && ({ ...data, show_money_out: value }));
}

/** The error the server gave, worded for a person. */
export function errorText(error: unknown) {
  const code = (error as { code?: string; message?: string })?.message ?? "";
  if (!code || code.startsWith("HTTP")) return "Something went wrong. Try again.";
  // The server's field codes ("invalid contact_email"), in words.
  const words: Record<string, string> = {
    "invalid contact_email": "That contact email doesn't look right.",
    "paid_on is too far ahead": "The paid date can be up to a year from today.",
    "invalid paid_on": "That paid date doesn't look right.",
    "delivered_on can't be in the future": "The delivered date can't be in the future.",
    "invalid delivered_on": "That delivered date doesn't look right.",
    "invalid unpaid_reason": "Pick why it didn't pay: Declined or Unresolved.",
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
