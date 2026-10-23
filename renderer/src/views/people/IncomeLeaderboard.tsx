import { useState } from "react";
import { Award, Check, Crown, LockKeyhole, ShieldCheck, Sparkles, Star, TrendingUp } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import {
  BEE_TIERS, formatMoney, getIncomeProgress, LbAvatar, LeaderboardViewToggle, MemberName, openProfile, tierDisplayName,
  type BeeTierKey, type LeaderboardView, type MemberBadge, type ProfileGender,
} from "./LeaderboardParts";
import styles from "./leaderboard.module.css";

/* The Income board, as on the website (components/leaderboard/IncomeLeaderboard.tsx). */

interface IncomeEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  amountUsd: number;
  tier: BeeTierKey;
  gender: ProfileGender | null;
  isCurrentUser: boolean;
  badge?: MemberBadge | null;
}

export interface IncomeLeaderboardResponse {
  ok: true;
  storageReady: boolean;
  eligible: boolean;
  isSharing: boolean;
  month: string;
  monthLabel: string;
  self: {
    amountUsd: number;
    previousMonthAmountUsd: number;
    tier: BeeTierKey;
    nextTier: BeeTierKey | null;
    amountToNextTier: number;
    progressPercent: number;
    gender: ProfileGender | null;
  };
  board?: {
    participantCount: number;
    tierCounts: Record<BeeTierKey, number>;
    entries: IncomeEntry[];
    waiting?: Omit<IncomeEntry, "rank" | "amountUsd" | "tier">[];
    topEarner: IncomeEntry | null;
  };
}

const TIER_ICONS = { newbie: Sparkles, hustle: Star, pro: Award, pink_queen: Crown } satisfies Record<BeeTierKey, typeof Sparkles>;

function monthDelta(current: number, previous: number) {
  const difference = current - previous;
  if (difference === 0) return "Same pace as last month";
  return `${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference))} vs last month`;
}

export function IncomeLeaderboard({ data, loading, error, onRetry, onDataChange, onViewChange }: {
  data: IncomeLeaderboardResponse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onDataChange: (data: IncomeLeaderboardResponse) => void;
  onViewChange: (view: LeaderboardView) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  async function updateSharing(shareIncome: boolean) {
    setUpdating(true);
    setUpdateError(null);
    try {
      onDataChange(await api<IncomeLeaderboardResponse>("/api/leaderboard/income", { method: "PUT", body: { shareIncome } }));
    } catch (caught) {
      setUpdateError(caught instanceof ApiError && caught.code === "income_leaderboard_storage_unavailable"
        ? "Apply the income leaderboard migration before changing this setting."
        : "Your privacy setting could not be updated. Try again.");
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.leaderboard} aria-busy="true">
        <IncomeHeader participantCount={0} onViewChange={onViewChange} />
        <div className={styles.incomeLoading}><span /><span /><span /></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.leaderboard}>
        <IncomeHeader participantCount={0} onViewChange={onViewChange} />
        <section className={styles.errorState}>
          <h2>Earnings are taking a breather</h2>
          <p>{error || "The income leaderboard could not be loaded."}</p>
          <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={onRetry}>Try again</button>
        </section>
      </div>
    );
  }

  const selfProgress = getIncomeProgress(data.self.amountUsd);
  const selfTierName = tierDisplayName(selfProgress.tier, data.self.gender);
  const selfNextTierName = selfProgress.nextTier ? tierDisplayName(selfProgress.nextTier, data.self.gender) : null;
  const privatePreview = (
    <div className={styles.privatePreview}>
      <div>
        <span>Your private progress · {data.monthLabel}</span>
        <strong>{selfTierName}</strong>
      </div>
      <b>{formatMoney(data.self.amountUsd)}</b>
    </div>
  );

  return (
    <div className={styles.leaderboard}>
      <IncomeHeader participantCount={data.board?.participantCount ?? 0} onViewChange={onViewChange} />

      {!data.board || (data.eligible && !data.isSharing) ? (!data.eligible ? (
        <section className={styles.incomeInvitation}>
          <div className={styles.invitationGlow} aria-hidden />
          <div className={styles.invitationIcon}><ShieldCheck aria-hidden size={23} /></div>
          <span className={styles.incomeKicker}>For students</span>
          <h2>The earnings board is for students</h2>
          <p>Students can share their current-month earnings here. Your earnings stay private and aren&apos;t ranked.</p>
          {privatePreview}
        </section>
      ) : (
        <section className={styles.incomeInvitation}>
          <div className={styles.invitationGlow} aria-hidden />
          <div className={styles.invitationIcon}><ShieldCheck aria-hidden size={23} /></div>
          <span className={styles.incomeKicker}>Private by default</span>
          <h2>Share your earnings on the leaderboard?</h2>
          <p>
            Totally optional. Share your current-month earnings to join the Bee-tier
            milestones and see how you rank. If you do nothing, your income stays private.
          </p>
          {privatePreview}
          <ul>
            <li><Check aria-hidden size={14} /> Visible to other opted-in students</li>
            <li><Check aria-hidden size={14} /> Leave anytime and disappear immediately</li>
            <li><LockKeyhole aria-hidden size={14} /> Never shared outside this private board</li>
          </ul>
          {!data.storageReady && (
            <div className={styles.incomeMigrationNotice}>The income leaderboard migration must be applied before sharing can be enabled.</div>
          )}
          {updateError && <div className={styles.incomeUpdateError} role="alert">{updateError}</div>}
          <button type="button" className={`ui-button ui-button--primary ui-button--md ui-button--full ${styles.incomeJoinButton}`}
            disabled={updating || !data.storageReady} onClick={() => void updateSharing(true)}>
            {updating ? "Joining…" : "Share my earnings"}
          </button>
          <small>You can turn this off from the income board at any time.</small>
        </section>
      )) : (
        <div className={styles.incomeBoard}>
          <section className={styles.incomeProgressGrid}>
            <article className={styles.incomeClimb}>
              <div className={styles.incomeClimbGlow} aria-hidden />
              <span className={styles.incomeKicker}>{data.eligible ? "Your climb" : "Your private progress"} · {data.monthLabel}</span>
              {selfProgress.nextTier ? (
                <h2>You&apos;re <em>{formatMoney(data.self.amountToNextTier)}</em> from {selfNextTierName}</h2>
              ) : (
                <h2>You reached <em>{selfTierName}</em></h2>
              )}
              <div className={styles.incomeProgressTrack} role="progressbar" aria-label={`Progress to ${selfNextTierName ?? "the top tier"}`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(data.self.progressPercent)}>
                <span style={{ width: `${data.self.progressPercent}%` }} />
              </div>
              <div className={styles.incomeProgressLabels}>
                <span>{formatMoney(data.self.amountUsd)} earned</span>
                <b>{selfProgress.nextTier ? `${formatMoney(selfProgress.nextTier.minimum)} · ${selfNextTierName}` : "Top tier unlocked"}</b>
              </div>
              <p className={data.self.amountUsd >= data.self.previousMonthAmountUsd ? styles.isUp : ""}>
                <TrendingUp aria-hidden size={13} />
                {data.self.amountUsd === 0 ? "Your first paid deal starts the climb." : monthDelta(data.self.amountUsd, data.self.previousMonthAmountUsd)}
              </p>
            </article>
            <TopEarner entry={data.board.topEarner} monthLabel={data.monthLabel} />
          </section>

          <section className={styles.incomeTierGrid} aria-label="Bee-tier milestones">
            {BEE_TIERS.map((tier) => {
              const Icon = TIER_ICONS[tier.key];
              const isCurrent = tier.key === data.self.tier;
              const count = data.board?.tierCounts[tier.key] ?? 0;
              return (
                <article key={tier.key} className={`${styles.incomeTierCard} ${styles[`incomeTier_${tier.key}`]} ${isCurrent ? styles.isCurrentTier : ""}`}>
                  <div className={styles.incomeTierIcon}><Icon aria-hidden size={19} /></div>
                  <div>
                    <h3>{tierDisplayName(tier, data.self.gender)}</h3>
                    <p>{tier.range} this month</p>
                  </div>
                  <strong>{count} {count === 1 ? "creator" : "creators"}</strong>
                  {isCurrent && <span>Your tier</span>}
                </article>
              );
            })}
          </section>

          <section className={styles.incomeRankings} aria-label="Opted-in income rankings">
            <div className={styles.incomeRankingsHeader}>
              <div>
                <span className={styles.incomeKicker}>Opted-in students</span>
                <h2>Monthly earnings board</h2>
              </div>
              <p>Every student here chose to share exact earnings.</p>
            </div>
            <div className={styles.incomeColumnLabels} aria-hidden>
              <span>Rank</span><span>Creator</span><span>Tier</span><span>Earned</span>
            </div>
            <div className={styles.incomeRows}>
              {data.board.entries.length === 0 ? (
                <div className={styles.incomeRowsEmpty}>
                  <Sparkles aria-hidden size={20} />
                  <div>
                    <strong>No collected earnings yet</strong>
                    <span>
                      {data.board.participantCount.toLocaleString()} opted-in {data.board.participantCount === 1 ? "creator is" : "creators are"} ready to compete this month.
                    </span>
                  </div>
                </div>
              ) : data.board.entries.map((entry) => {
                const tier = getIncomeProgress(entry.amountUsd).tier;
                return (
                  <article key={entry.userId} className={`lb-clickable ${entry.isCurrentUser ? styles.isIncomeCurrentUser : ""}`} onClick={openProfile(entry.userId)}>
                    <span className={styles.incomeRank}>#{entry.rank}</span>
                    <div className={styles.incomeCreator}>
                      <LbAvatar name={entry.name} id={entry.userId} src={entry.avatarUrl} size={38} />
                      <div>
                        <MemberName as="strong" name={entry.name} badge={entry.badge} size="compact" />
                        {entry.isCurrentUser && <span>You</span>}
                      </div>
                    </div>
                    <span className={`${styles.incomeTierPill} ${styles[`is_${tier.key}`]}`}>{tierDisplayName(tier, entry.gender)}</span>
                    <b>{formatMoney(entry.amountUsd)}</b>
                  </article>
                );
              })}
              {data.board.waiting?.map((entry) => (
                <article key={entry.userId} className={`lb-clickable ${styles.incomeWaitingRow} ${entry.isCurrentUser ? styles.isIncomeCurrentUser : ""}`} onClick={openProfile(entry.userId)}>
                  <span className={styles.incomeRank} aria-label="Not ranked yet">—</span>
                  <div className={styles.incomeCreator}>
                    <LbAvatar name={entry.name} id={entry.userId} src={entry.avatarUrl} size={38} />
                    <div>
                      <MemberName as="strong" name={entry.name} badge={entry.badge} size="compact" />
                      {entry.isCurrentUser && <span>You</span>}
                    </div>
                  </div>
                  <span className={styles.incomeWaitingNote}>Waiting for first payday</span>
                  <b>{formatMoney(0)}</b>
                </article>
              ))}
            </div>
          </section>

          {data.eligible ? (
            <footer className={styles.incomePrivacyFooter}>
              <div>
                <ShieldCheck aria-hidden size={17} />
                <span>Sharing exact {data.monthLabel.toLowerCase()} earnings with opted-in creators.</span>
              </div>
              <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={updating} onClick={() => void updateSharing(false)}>
                {updating ? "Updating…" : "Stop sharing"}
              </button>
              {updateError && <p role="alert">{updateError}</p>}
            </footer>
          ) : (
            <footer className={styles.incomePrivacyFooter}>
              <div>
                <ShieldCheck aria-hidden size={17} />
                <span>The board is for students. Your earnings stay private and aren&apos;t ranked.</span>
              </div>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

function IncomeHeader({ participantCount, onViewChange }: { participantCount: number; onViewChange: (view: LeaderboardView) => void }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>Earnings</h1>
        <p>Opt-in only{participantCount > 0 ? ` · ${participantCount.toLocaleString()} students sharing` : " · private by default"}</p>
      </div>
      <LeaderboardViewToggle view="income" onChange={onViewChange} />
    </header>
  );
}

function TopEarner({ entry, monthLabel }: { entry: IncomeEntry | null; monthLabel: string }) {
  if (!entry) {
    return (
      <article className={`${styles.incomeTopEarner} ${styles.isEmpty}`}>
        <span className={styles.incomeKicker}>Top earner</span>
        <h2>The first spot is open</h2>
        <p>A completed paid deal puts a creator on the board.</p>
      </article>
    );
  }
  const tier = getIncomeProgress(entry.amountUsd).tier;
  return (
    <article className={`lb-clickable ${styles.incomeTopEarner}`} onClick={openProfile(entry.userId)}>
      <span className={styles.incomeKicker}>Top earner · {monthLabel}</span>
      <div>
        <LbAvatar name={entry.name} id={entry.userId} src={entry.avatarUrl} size={46} />
        <div>
          <MemberName as="h2" name={entry.name} badge={entry.badge} />
          <p>{tierDisplayName(tier, entry.gender)} · <b>{formatMoney(entry.amountUsd)}</b></p>
        </div>
      </div>
      <small>Shared with their permission.</small>
    </article>
  );
}
