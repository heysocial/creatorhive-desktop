import { useEffect, useState } from "react";
import { Flame, Minus, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { money } from "../../lib/format";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";

interface Entry {
  rank: number | null;
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  points: number;
  currentStreak: number;
  trend: { direction: "up" | "down" | "same" | "new"; delta: number };
  isCurrentUser: boolean;
  badge?: { kind: string; label: string } | null;
}

interface Board {
  entries: Entry[];
  self: (Entry & { breakdown: { eventType: string; count: number; totalPoints: number }[] }) | null;
  pointValues: Record<string, number>;
  period: { label: string; endsAt: string } | null;
  participantCount: number;
}

interface Prize {
  prize: { prizeName: string; prizeImageUrl: string | null } | null;
  endsAt: string;
  month: string;
  leader: { userId: string; name: string; avatarUrl: string | null; points: number } | null;
}

interface Income {
  eligible: boolean;
  isSharing: boolean;
  monthLabel: string;
  self: { amountUsd: number; tier: string; nextTier: string | null; amountToNextTier: number | null; progressPercent: number };
  board?: { participantCount: number; entries: { rank: number; userId: string; name: string; avatarUrl: string | null; amountUsd: number; tier: string; isCurrentUser: boolean; badge?: { kind: string; label: string } | null }[] };
}

const EVENT_LABEL: Record<string, string> = {
  post_created: "Write a post",
  comment_created: "Comment on a post",
  reaction_received: "Someone reacts to your post",
  lesson_completed: "Complete a lesson",
  event_rsvpd: "RSVP to an event",
  daily_login: "Open CreatorHive (once a day)",
};

const TIER_LABEL: Record<string, string> = { newbie: "New Bee", hustle: "Hustle Bee", pro: "Pro Bee", pink_queen: "Queen Bee" };

function daysLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const days = Math.ceil(ms / 86_400_000);
  return days === 1 ? "1 day" : `${days} days`;
}

function Medal({ rank }: { rank: number | null }) {
  if (rank === 1) return <span className="medal">🥇</span>;
  if (rank === 2) return <span className="medal">🥈</span>;
  if (rank === 3) return <span className="medal">🥉</span>;
  return <span>{rank ?? "–"}</span>;
}

function Trend({ trend }: { trend: Entry["trend"] }) {
  if (trend.direction === "up") return <span className="trend up"><TrendingUp />{trend.delta}</span>;
  if (trend.direction === "down") return <span className="trend down"><TrendingDown />{Math.abs(trend.delta)}</span>;
  if (trend.direction === "new") return <span className="trend new">New</span>;
  return <span className="trend"><Minus /></span>;
}

function ActivityBoard({ scope }: { scope: "week" | "month" | "all" }) {
  const board = useQuery({ queryKey: ["leaderboard", scope], queryFn: () => api<Board>(`/api/leaderboard?scope=${scope}&limit=50`) });
  const prize = useQuery({ queryKey: ["leaderboard", "prize"], queryFn: () => api<Prize>("/api/leaderboard/prize") });
  const self = board.data?.self;
  const entries = board.data?.entries ?? [];
  const above = self?.rank && self.rank > 1 ? entries.find((e) => e.rank === self.rank! - 1) : null;
  const gap = above && self ? above.points - self.points + 1 : null;
  const values = board.data?.pointValues ?? {};
  const cheapest = gap ? Object.entries(values).sort((a, b) => b[1] - a[1]).find(([, v]) => v >= gap) : null;

  return (
    <div className="lb-body">
      <div className="lb-main scroll">
        {scope === "month" && prize.data?.prize ? (
          <div className="prize">
            <div className="prize-img">{prize.data.prize.prizeImageUrl ? <img src={prize.data.prize.prizeImageUrl} alt="" /> : <Trophy />}</div>
            <div className="prize-text">
              <span className="eyebrow">This month's prize · {new Date(`${prize.data.month.slice(0, 10)}T12:00:00Z`).toLocaleDateString([], { month: "long", timeZone: "UTC" })}</span>
              <h2>{prize.data.prize.prizeName}</h2>
              {prize.data.leader ? (
                <span className="leader"><Avatar name={prize.data.leader.name} src={prize.data.leader.avatarUrl} seed={prize.data.leader.userId} size={24} />Current leader <b>{prize.data.leader.name}</b> · {prize.data.leader.points} pts</span>
              ) : null}
            </div>
            <div className="prize-ends"><small>Ends in</small><b>{daysLeft(prize.data.endsAt)}</b><small>{new Date(prize.data.endsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></div>
          </div>
        ) : null}
        <div className="card lb-table">
          <div className="lb-row head"><span>Rank</span><span>Creator</span><span>Tier</span><span className="r">Points</span><span className="r">Streak</span><span className="r">Trend</span></div>
          {board.isLoading ? <div className="msgs-skel" style={{ padding: 14 }}><div /><div /><div /></div> : null}
          {board.isError ? <div className="err-state">Couldn't load the leaderboard.</div> : null}
          {entries.map((e) => (
            <button key={e.userId} className={`lb-row ${e.isCurrentUser ? "me" : ""}`} onClick={() => nav.open({ kind: "profile", id: e.userId })}>
              <span><Medal rank={e.rank} /></span>
              <span className="who"><Avatar name={e.name} src={e.avatarUrl} seed={e.userId} size={30} /><b>{e.name}</b>{e.isCurrentUser ? <span className="pill">You</span> : null}</span>
              <span className="muted">{e.badge?.label ?? ""}</span>
              <span className="r"><b>{e.points.toLocaleString()}</b></span>
              <span className="r streak">{e.currentStreak ? <><Flame />{e.currentStreak}</> : "–"}</span>
              <span className="r"><Trend trend={e.trend} /></span>
            </button>
          ))}
          {board.isSuccess && entries.length === 0 ? <div className="empty-state">No points yet this {scope === "week" ? "week" : "month"}.</div> : null}
        </div>
      </div>
      <aside className="lb-side scroll">
        <h3>How you earned your points</h3>
        {self ? (
          <>
            {Object.entries(EVENT_LABEL).map(([type, label]) => {
              const row = self.breakdown.find((b) => b.eventType === type);
              return (
                <div key={type} className="earn">
                  <span>{label}</span><span className="faint">{row?.count ?? 0} × {values[type] ?? 0}</span><b>{row?.totalPoints ?? 0}</b>
                </div>
              );
            })}
            <div className="earn total"><span>Total</span><b>{self.points.toLocaleString()}</b></div>
            {above && gap ? (
              <div className="t-card static"><span className="t-ico flame"><Flame /></span>
                <span><b>{gap} {gap === 1 ? "point" : "points"} to pass {above.name.split(" ")[0]}</b><small>{cheapest ? `${EVENT_LABEL[cheapest[0]]?.replace(/ \(.*\)$/, "")} does it` : "Keep going"}</small></span>
              </div>
            ) : self.rank === 1 ? <div className="t-card static"><span className="t-ico honey"><Trophy /></span><span><b>You're in first place</b><small>Keep your streak going</small></span></div> : null}
          </>
        ) : <p className="muted">Earn points by posting, commenting, finishing lessons and showing up each day.</p>}
      </aside>
    </div>
  );
}

function IncomeBoard() {
  const income = useQuery({ queryKey: ["leaderboard", "income"], queryFn: () => api<Income>("/api/leaderboard/income") });
  const [saving, setSaving] = useState(false);
  const data = income.data;
  if (income.isLoading) return <div className="empty-state">Loading…</div>;
  if (!data) return <div className="empty-state">Couldn't load the income board.</div>;
  return (
    <div className="lb-body">
      <div className="lb-main scroll">
        {data.eligible ? (
          <div className="card income-self">
            <div><span className="eyebrow">Collected in {data.monthLabel}</span><b className="big">{money(data.self.amountUsd)}</b>
              <span className="muted">{TIER_LABEL[data.self.tier] ?? data.self.tier}{data.self.nextTier && data.self.amountToNextTier ? ` · ${money(data.self.amountToNextTier)} to ${TIER_LABEL[data.self.nextTier] ?? data.self.nextTier}` : ""}</span></div>
            <div className="paid-bar"><i className="paid" style={{ width: `${data.self.progressPercent}%` }} /></div>
            <label className="toggle-row">
              <input type="checkbox" checked={data.isSharing} disabled={saving} onChange={async (e) => {
                setSaving(true);
                try { await api("/api/leaderboard/income", { method: "PUT", body: { shareIncome: e.target.checked } }); await income.refetch(); } finally { setSaving(false); }
              }} />
              Show my income on the board
            </label>
          </div>
        ) : null}
        {data.board ? (
          <div className="card lb-table">
            <div className="lb-row head income"><span>Rank</span><span>Creator</span><span>Tier</span><span className="r">Collected</span></div>
            {data.board.entries.map((e) => (
              <button key={e.userId} className={`lb-row income ${e.isCurrentUser ? "me" : ""}`} onClick={() => nav.open({ kind: "profile", id: e.userId })}>
                <span><Medal rank={e.rank} /></span>
                <span className="who"><Avatar name={e.name} src={e.avatarUrl} seed={e.userId} size={30} /><b>{e.name}</b>{e.isCurrentUser ? <span className="pill">You</span> : null}</span>
                <span className="muted">{TIER_LABEL[e.tier] ?? e.tier}</span>
                <span className="r"><b>{money(e.amountUsd)}</b></span>
              </button>
            ))}
            {data.board.entries.length === 0 ? <div className="empty-state">Nobody is sharing their income yet this month.</div> : null}
          </div>
        ) : <div className="empty-state">Turn on sharing to see the income board.</div>}
      </div>
    </div>
  );
}

export function Leaderboard() {
  const [tab, setTab] = useState<"activity" | "income">(() => (localStorage.getItem("ch.lb.tab") as "income") || "activity");
  const [scope, setScope] = useState<"week" | "month" | "all">("month");
  useEffect(() => { try { localStorage.setItem("ch.lb.tab", tab); } catch { /* fine */ } }, [tab]);
  return (
    <div className="page leaderboard">
      <div className="mhead">
        <h1>Leaderboard</h1>
        <div className="seg">
          <button className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>Activity</button>
          <button className={tab === "income" ? "on" : ""} onClick={() => setTab("income")}>Income</button>
        </div>
        {tab === "activity" ? (
          <div className="acts">
            <div className="seg">
              <button className={scope === "week" ? "on" : ""} onClick={() => setScope("week")}>Week</button>
              <button className={scope === "month" ? "on" : ""} onClick={() => setScope("month")}>This month</button>
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All-time</button>
            </div>
          </div>
        ) : null}
      </div>
      {tab === "activity" ? <ActivityBoard scope={scope} /> : <IncomeBoard />}
    </div>
  );
}

