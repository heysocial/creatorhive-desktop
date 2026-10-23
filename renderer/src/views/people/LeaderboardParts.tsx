import { useEffect, useId, useRef, useState, type CSSProperties, type ElementType, type MouseEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { nav } from "../../lib/nav";
import styles from "./leaderboard.module.css";

/*
  The website's small Leaderboard pieces (creatorhive-app components/ui and
  lib/*), so the page draws exactly as it does there: its avatar tints, member
  badges, empty state, Activity/Income switch, "How points work", tiers and
  point values.
*/

export interface MemberBadge {
  kind: "owner" | "team" | "new" | "hustle" | "pro" | "top" | string;
  label: string;
  colorKey?: string;
}

export type ProfileGender = "female" | "male" | "non_binary" | "prefer_not_to_say" | string;
export type BeeTierKey = "newbie" | "hustle" | "pro" | "pink_queen";

const AVATAR_TINTS = [
  "linear-gradient(135deg, #5159D8, #6D4FD6)",
  "linear-gradient(135deg, #1B7F48, #15803D)",
  "linear-gradient(135deg, #B45309, #C2410C)",
  "linear-gradient(135deg, #C42B35, #BE123C)",
  "linear-gradient(135deg, #0E7490, #0369A1)",
  "linear-gradient(135deg, #7E22CE, #A21CAF)",
] as const;

function avatarTint(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/** The website's avatar: gradient tint and initials, or the photo. */
export function LbAvatar({ name, id, src, size = 32 }: { name: string; id?: string; src?: string | null; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const font = size <= 24 ? 9 : size <= 28 ? 10 : size <= 32 ? 11 : Math.round(size * 0.34);
  return (
    <div aria-hidden style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          width: size, height: size, borderRadius: 999, background: avatarTint(id ?? name),
          display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          fontSize: font, fontWeight: 600, letterSpacing: "-0.005em",
          boxShadow: "inset 0 0 0 0.5px color-mix(in oklab, #000 20%, transparent), inset 0 1px 0 0 color-mix(in oklab, #fff 22%, transparent), inset 0 -1px 0 0 color-mix(in oklab, #000 12%, transparent)",
        }}
      >
        {src && failedSrc !== src ? (
          <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)}
            style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
        ) : initials(name)}
      </div>
    </div>
  );
}

const TITLE_COLORS: Record<string, string> = {
  teal: "#2A9D8F", blue: "#3B82F6", indigo: "#6366F1", violet: "#8B5CF6", orchid: "#B453C6",
  rose: "#D65A7A", coral: "#E06B56", amber: "#B7791F", green: "#3A9363", slate: "#718096",
};

function badgeEmoji(kind: string) {
  if (kind === "pro") return "🐝";
  if (kind === "top") return "👑";
  return null;
}

/** A member's name with their badge (bee tier, role or custom title), as on the website. */
export function MemberName({ name, badge, as: Component = "span", size = "default" }: {
  name: string;
  badge?: MemberBadge | null;
  as?: ElementType;
  size?: "compact" | "default";
}) {
  return (
    <Component className={`member-name member-name--${size}`}>
      <span className="member-name__text">{name || "Unknown"}</span>
      {badge ? (
        <span
          className={`member-badge member-badge--${badge.kind}`}
          style={badge.colorKey ? { "--member-badge-color": TITLE_COLORS[badge.colorKey] ?? TITLE_COLORS.teal } as CSSProperties : undefined}
          data-title-color={badge.colorKey}
          title={badge.label}
        >
          {!badge.colorKey && badgeEmoji(badge.kind) ? <span className="member-badge__emoji" aria-hidden="true">{badgeEmoji(badge.kind)}</span> : null}
          {badge.label}
        </span>
      ) : null}
    </Component>
  );
}

/** Clicking a person opens their profile, as everywhere else in the app (the website's rows don't link). */
export function openProfile(id: string) {
  return (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    nav.open({ kind: "profile", id });
  };
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="ui-empty-state">
      <div aria-hidden className="ui-empty-state__icon">{icon}</div>
      <div className="ui-empty-state__title">{title}</div>
      {description && <div className="ui-empty-state__description">{description}</div>}
    </div>
  );
}

export type LeaderboardView = "activity" | "income";

export function LeaderboardViewToggle({ view, onChange }: { view: LeaderboardView; onChange: (view: LeaderboardView) => void }) {
  return (
    <div className={`ui-segmented ${styles.viewToggle}`} role="group" aria-label="Leaderboard type">
      <button type="button" className="ui-chip" aria-pressed={view === "activity"} onClick={() => onChange("activity")}>Activity</button>
      <button type="button" className="ui-chip" aria-pressed={view === "income"} onClick={() => onChange("income")}>Income</button>
    </div>
  );
}

export const POINT_VALUES: Record<string, number> = {
  post_created: 10,
  comment_created: 5,
  reaction_received: 2,
  lesson_completed: 15,
  event_rsvpd: 3,
  daily_login: 5,
};

const POINT_RULES = [
  { eventType: "lesson_completed", label: "Complete a lesson" },
  { eventType: "post_created", label: "Write a post" },
  { eventType: "comment_created", label: "Comment on a post" },
  { eventType: "daily_login", label: "Open CreatorHive (once a day)" },
  { eventType: "event_rsvpd", label: "RSVP to an event" },
  { eventType: "reaction_received", label: "Someone reacts to your post" },
];

/** "How points work": shows on hover or focus, and stays open on click. */
export function PointsInfo() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const open = pinned || hovered;

  useEffect(() => {
    if (!pinned) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setPinned(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPinned(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [pinned]);

  return (
    <span
      ref={rootRef}
      className={styles.pointsInfo}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHovered(false); }}
    >
      <button type="button" className={styles.pointsInfoButton} aria-label="How points work" aria-expanded={open} aria-controls={panelId}
        onClick={() => setPinned((value) => !value)}>
        <Info size={17} aria-hidden="true" />
      </button>
      <span id={panelId} role="tooltip" className={styles.pointsInfoPanel} hidden={!open}>
        <strong>How points work</strong>
        <span className={styles.pointsInfoRows}>
          {POINT_RULES.map((rule) => (
            <span key={rule.eventType} className={styles.pointsInfoRow}>
              <span>{rule.label}</span>
              <b>+{POINT_VALUES[rule.eventType]}</b>
            </span>
          ))}
        </span>
        <small>Points reset on the 1st of each month. Mods remove points earned from spam.</small>
      </span>
    </span>
  );
}

export interface BeeTier {
  key: BeeTierKey;
  name: string;
  minimum: number;
  nextMinimum: number | null;
  range: string;
}

export const BEE_TIERS: readonly BeeTier[] = [
  { key: "newbie", name: "New Bee", minimum: 0, nextMinimum: 1_000, range: "$0–999" },
  { key: "hustle", name: "Hustle Bee", minimum: 1_000, nextMinimum: 3_000, range: "$1,000–2,999" },
  { key: "pro", name: "Pro Bee", minimum: 3_000, nextMinimum: 10_000, range: "$3,000–9,999" },
  { key: "pink_queen", name: "King/Queen Bee", minimum: 10_000, nextMinimum: null, range: "$10,000+" },
];

export function getIncomeProgress(amountUsd: number) {
  const safeAmount = Math.max(0, Math.trunc(amountUsd));
  const tier = [...BEE_TIERS].reverse().find((candidate) => safeAmount >= candidate.minimum) ?? BEE_TIERS[0];
  const tierIndex = BEE_TIERS.findIndex((candidate) => candidate.key === tier.key);
  const nextTier = tierIndex < BEE_TIERS.length - 1 ? BEE_TIERS[tierIndex + 1] : null;
  return { tier, nextTier };
}

export function tierDisplayName(tier: BeeTier, gender: ProfileGender | null) {
  return tier.key === "pink_queen" ? (gender === "male" ? "King Bee" : "Queen Bee") : tier.name;
}

export function formatMoney(dollars: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(dollars);
}
