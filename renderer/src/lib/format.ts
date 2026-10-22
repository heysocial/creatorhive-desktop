/* Times, days and money, worded the way the website words them. */

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function clock(iso: string | Date) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Yesterday", "Monday, October 19" (with the year when it isn't this year). */
export function dayLabel(iso: string | Date) {
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** "now", "5m", "3h", "2d", then a date. For feeds and lists. */
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  const date = new Date(iso);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** For sidebars: a time today, a weekday this week, else a short date. */
export function shortTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) return clock(date);
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fullDate(iso: string | Date) {
  return new Date(iso).toLocaleString([], { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole dollars unless there are cents. */
export function money(value: number | string | null | undefined, currency = "USD") {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  if (currency !== "USD") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  }
  return Number.isInteger(n) ? money0.format(n) : money2.format(n);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function bytes(size: number | null | undefined) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
