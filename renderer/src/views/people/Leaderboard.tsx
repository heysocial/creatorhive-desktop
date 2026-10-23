import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crown, Flame, Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { EmptyState, LbAvatar, LeaderboardViewToggle, MemberName, openProfile, PointsInfo, type LeaderboardView, type MemberBadge } from "./LeaderboardParts";
import { PrizeHero, PRIZE_KEY, type PrizeHeroData } from "./PrizeHero";
import { IncomeLeaderboard, type IncomeLeaderboardResponse } from "./IncomeLeaderboard";
import styles from "./leaderboard.module.css";
import "./leaderboard-web.css";

/*
  The Leaderboard, drawn exactly as the website's (creatorhive-app
  app/leaderboard and components/leaderboard): the month's prize banner, the
  top three on a podium, the ranked list, your rank pinned below, and the
  Income board. Its styles are the website's own, copied alongside.
*/

type LeaderboardScope = "week" | "month" | "all";
type TrendDirection = "up" | "down" | "same" | "new";

interface PointsBreakdownItem {
  eventType: string;
  count: number;
  totalPoints: number;
}

interface ActivityEntry {
  rank: number | null;
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  badge?: MemberBadge | null;
  points: number;
  currentStreak: number;
  trend: { direction: TrendDirection; delta: number; previousRank: number | null; previousPoints: number };
  isCurrentUser: boolean;
}

interface CurrentUserEntry extends ActivityEntry {
  breakdown: PointsBreakdownItem[];
}

interface LeaderboardResponse {
  ok: boolean;
  scope?: LeaderboardScope;
  participantCount?: number;
  entries?: ActivityEntry[];
  self?: CurrentUserEntry | null;
}

const EVENT_LABELS: Record<string, { singular: string; plural: string }> = {
  post_created: { singular: "post", plural: "posts" },
  comment_created: { singular: "comment", plural: "comments" },
  reaction_received: { singular: "reaction", plural: "reactions" },
  lesson_completed: { singular: "lesson", plural: "lessons" },
  event_rsvpd: { singular: "event RSVP", plural: "event RSVPs" },
  daily_login: { singular: "daily login", plural: "daily logins" },
};

const SCOPE_LABELS: Record<LeaderboardScope, string> = { week: "Week", month: "This month", all: "All-time" };

function eventLabel(item: PointsBreakdownItem) {
  const labels = EVENT_LABELS[item.eventType];
  if (!labels) return item.eventType.replaceAll("_", " ");
  return item.count === 1 ? labels.singular : labels.plural;
}

function Trend({ entry, compact = false }: { entry: ActivityEntry; compact?: boolean }) {
  const { direction, delta } = entry.trend;
  if (direction === "new") {
    return <span className={`${styles.trend} ${styles.trendUp}`} title="New to this period"><TrendingUp aria-hidden size={compact ? 11 : 13} />New</span>;
  }
  if (direction === "up") {
    return <span className={`${styles.trend} ${styles.trendUp}`} title={`Up ${delta} ranks`}><TrendingUp aria-hidden size={compact ? 11 : 13} />{delta}</span>;
  }
  if (direction === "down") {
    return <span className={`${styles.trend} ${styles.trendDown}`} title={`Down ${delta} ranks`}><TrendingDown aria-hidden size={compact ? 11 : 13} />{delta}</span>;
  }
  return <span className={`${styles.trend} ${styles.trendSame}`} title="Rank unchanged"><Minus aria-hidden size={compact ? 11 : 13} />Same</span>;
}

function BreakdownPopover({ items }: { items: PointsBreakdownItem[] }) {
  return (
    <div className={styles.breakdownPopover} role="dialog" aria-label="Your points breakdown">
      <div className={styles.breakdownTitle}>How you earned your points</div>
      {items.length > 0 ? (
        <div className={styles.breakdownList}>
          {items.map((item) => (
            <div className={styles.breakdownItem} key={item.eventType}>
              <span>{item.count} {eventLabel(item)}</span>
              <strong>+{item.totalPoints}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.breakdownEmpty}>Your activity breakdown will appear here.</p>
      )}
    </div>
  );
}

function PointsValue({ entry, breakdown, breakdownOpen, onToggleBreakdown, hero = false }: {
  entry: ActivityEntry;
  breakdown?: PointsBreakdownItem[];
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
  hero?: boolean;
}) {
  if (!entry.isCurrentUser || !breakdown) {
    return (
      <span className={hero ? styles.podiumPoints : styles.rowPoints}>
        {entry.points.toLocaleString()}
        {hero && <small> pts</small>}
      </span>
    );
  }
  return (
    <div
      className={styles.pointsControl}
      data-open={breakdownOpen ? "true" : "false"}
      onPointerEnter={() => { if (!breakdownOpen) onToggleBreakdown(); }}
      onPointerLeave={() => { if (breakdownOpen) onToggleBreakdown(); }}
    >
      <button type="button" className={`${styles.pointsButton} ${hero ? styles.podiumPoints : styles.rowPoints}`}
        aria-expanded={breakdownOpen} aria-label={`View your ${entry.points.toLocaleString()} point breakdown`} onClick={onToggleBreakdown}>
        {entry.points.toLocaleString()}
        {hero && <small> pts</small>}
      </button>
      {breakdownOpen && <BreakdownPopover items={breakdown} />}
    </div>
  );
}

function PodiumCard({ entry, breakdown, breakdownOpen, onToggleBreakdown }: {
  entry: ActivityEntry;
  breakdown?: PointsBreakdownItem[];
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
}) {
  const rank = entry.rank ?? 0;
  return (
    <article className={`lb-clickable ${styles.podiumCard} ${styles[`podiumRank${rank}`]} ${entry.isCurrentUser ? styles.isCurrentUser : ""}`}
      onClick={openProfile(entry.userId)}>
      {rank === 1 && (
        <>
          <div className={styles.championLabel}><Crown aria-hidden size={12} />Champion</div>
          <Sparkles aria-hidden className={styles.championSparkle} size={18} />
        </>
      )}
      <div className={styles.podiumAvatar}>
        <LbAvatar name={entry.name} id={entry.userId} src={entry.avatarUrl} size={rank === 1 ? 72 : rank === 2 ? 56 : 52} />
        {entry.isCurrentUser && <span className={styles.youBadge}>You</span>}
      </div>
      <MemberName as="h2" name={entry.name} badge={entry.badge} />
      <PointsValue entry={entry} breakdown={breakdown} breakdownOpen={breakdownOpen} onToggleBreakdown={onToggleBreakdown} hero />
      <div className={styles.podiumMeta}>
        <span className={styles.streak}><Flame aria-hidden size={12} />{entry.currentStreak}d</span>
        <Trend entry={entry} compact />
      </div>
      <span className={styles.rankChip}>#{rank}</span>
    </article>
  );
}

function RankedRow({ entry, breakdown, breakdownOpen, onToggleBreakdown, pinned = false }: {
  entry: ActivityEntry;
  breakdown?: PointsBreakdownItem[];
  breakdownOpen: boolean;
  onToggleBreakdown: () => void;
  pinned?: boolean;
}) {
  return (
    <article className={`lb-clickable ${styles.rankedRow} ${entry.isCurrentUser ? styles.isCurrentUser : ""} ${pinned ? styles.pinnedRow : ""}`}
      onClick={openProfile(entry.userId)}>
      <span className={styles.rowRank}>{entry.rank ?? "—"}</span>
      <div className={styles.creator}>
        <LbAvatar name={entry.name} id={entry.userId} src={entry.avatarUrl} size={pinned ? 40 : 36} />
        <div>
          <MemberName as="strong" name={entry.name} badge={entry.badge} size="compact" />
          <span className={entry.rank == null ? styles.unrankedMeta : undefined}>
            {entry.rank == null ? "Unranked" : entry.isCurrentUser ? "Your activity" : "Creator"}
          </span>
        </div>
        {entry.isCurrentUser && <span className={styles.youBadge}>You</span>}
      </div>
      <span className={styles.rowStreak}><Flame aria-hidden size={13} />{entry.currentStreak}d</span>
      <Trend entry={entry} />
      <PointsValue entry={entry} breakdown={breakdown} breakdownOpen={breakdownOpen} onToggleBreakdown={onToggleBreakdown} />
    </article>
  );
}

function ActivityLeaderboard({ scope, entries, self, participantCount, onScopeChange, onViewChange, hero }: {
  scope: LeaderboardScope;
  entries: ActivityEntry[];
  self: CurrentUserEntry | null;
  participantCount: number;
  onScopeChange: (scope: LeaderboardScope) => void;
  onViewChange: (view: LeaderboardView) => void;
  hero?: ReactNode;
}) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!breakdownOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setBreakdownOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setBreakdownOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [breakdownOpen]);

  const toggleBreakdown = () => setBreakdownOpen((open) => !open);
  const podiumEntries = [entries[1], entries[0], entries[2]].filter((entry): entry is ActivityEntry => Boolean(entry));
  const rankedEntries = entries.slice(3);
  const currentUserIsVisible = entries.some((entry) => entry.isCurrentUser);

  return (
    <div className={styles.leaderboard} ref={rootRef}>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.pointsTitle}><h1>Leaderboard</h1><PointsInfo /></div>
          <p>Creator Hive Academy · {participantCount.toLocaleString()} students</p>
        </div>
        <div className={styles.headerControls}>
          <LeaderboardViewToggle view="activity" onChange={onViewChange} />
          <div className={`ui-segmented ${styles.scopeToggle}`} role="group" aria-label="Leaderboard period">
            {(Object.keys(SCOPE_LABELS) as LeaderboardScope[]).map((value) => (
              <button type="button" key={value} className="ui-chip" aria-pressed={scope === value}
                onClick={() => { setBreakdownOpen(false); onScopeChange(value); }}>
                {SCOPE_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {hero}

      {entries.length === 0 ? (
        <section className={styles.emptyState}>
          <EmptyState icon={<TrendingUp size={25} />} title="No points earned yet" description="Be the first to post, help another creator, or finish a lesson." />
          {self && <RankedRow entry={self} breakdown={self.breakdown} breakdownOpen={breakdownOpen} onToggleBreakdown={toggleBreakdown} />}
        </section>
      ) : (
        <>
          <section className={styles.podium} aria-label="Top three creators">
            {podiumEntries.map((entry) => (
              <PodiumCard key={entry.userId} entry={entry} breakdown={entry.isCurrentUser ? self?.breakdown : undefined}
                breakdownOpen={entry.isCurrentUser && breakdownOpen} onToggleBreakdown={toggleBreakdown} />
            ))}
          </section>

          {rankedEntries.length > 0 && (
            <section className={styles.rankedList} aria-label="Activity rankings">
              <div className={styles.listHeader} aria-hidden>
                <span>Rank</span><span>Creator</span><span>Streak</span><span>Trend</span><span>Points</span>
              </div>
              <div className={styles.rows}>
                {rankedEntries.map((entry) => (
                  <RankedRow key={entry.userId} entry={entry} breakdown={entry.isCurrentUser ? self?.breakdown : undefined}
                    breakdownOpen={entry.isCurrentUser && breakdownOpen} onToggleBreakdown={toggleBreakdown} />
                ))}
              </div>
            </section>
          )}

          {!currentUserIsVisible && self && (
            <aside className={styles.yourRank} aria-label="Your current rank">
              <span className={styles.yourRankLabel}>Your rank</span>
              <RankedRow entry={self} breakdown={self.breakdown} breakdownOpen={breakdownOpen} onToggleBreakdown={toggleBreakdown} pinned />
            </aside>
          )}
        </>
      )}
    </div>
  );
}

export function Leaderboard() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<LeaderboardView>(() => {
    try { return localStorage.getItem("ch.lb.tab") === "income" ? "income" : "activity"; } catch { return "activity"; }
  });
  const [scope, setScope] = useState<LeaderboardScope>("month");
  useEffect(() => { try { localStorage.setItem("ch.lb.tab", view); } catch { /* storage blocked */ } }, [view]);

  const board = useQuery({
    queryKey: ["leaderboard", scope],
    queryFn: () => api<LeaderboardResponse>(`/api/leaderboard?scope=${scope}`),
    placeholderData: (previous) => previous,
  });
  const prize = useQuery({ queryKey: PRIZE_KEY, queryFn: () => api<PrizeHeroData>("/api/leaderboard/prize") });
  const income = useQuery({
    queryKey: ["leaderboard", "income"],
    queryFn: () => api<IncomeLeaderboardResponse>("/api/leaderboard/income"),
    enabled: view === "income",
    staleTime: 0,
  });

  let content: ReactNode;
  if (view === "income") {
    content = (
      <IncomeLeaderboard
        data={income.data ?? null}
        loading={income.isPending}
        error={income.isError ? "Unable to load earnings right now." : null}
        onRetry={() => void income.refetch()}
        onDataChange={(data) => queryClient.setQueryData(["leaderboard", "income"], data)}
        onViewChange={setView}
      />
    );
  } else if (board.isPending || prize.isPending) {
    content = (
      <div className={styles.leaderboard} aria-busy="true" aria-label="Loading leaderboard">
        <div className={styles.loadingHeader}><span /><span /></div>
        <div className={styles.loadingPodium}><span /><span /><span /></div>
        <div className={styles.loadingRows}><span /><span /><span /></div>
      </div>
    );
  } else if (board.isError) {
    content = (
      <div className={styles.leaderboard}>
        <section className={styles.errorState}>
          <h1>Leaderboard</h1>
          <p>Unable to load the leaderboard right now.</p>
          <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void board.refetch()}>Try again</button>
        </section>
      </div>
    );
  } else {
    content = (
      <ActivityLeaderboard
        scope={scope}
        entries={board.data.entries ?? []}
        self={board.data.self ?? null}
        participantCount={board.data.participantCount ?? 0}
        onScopeChange={setScope}
        onViewChange={setView}
        hero={prize.data ? <PrizeHero data={prize.data} /> : (
          <section className={styles.errorState} aria-label="Prize unavailable">
            <h2>Prize details are unavailable</h2>
            <p>The leaderboard is still here. Try loading this month&apos;s prize again.</p>
            <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void prize.refetch()}>Try again</button>
          </section>
        )}
      />
    );
  }

  return <div className="page lb-web lb-page">{content}</div>;
}
