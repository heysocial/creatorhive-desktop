import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImageIcon, Pencil, Sparkles, Trophy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { Modal } from "../hub/parts";
import { LbAvatar, MemberName, type MemberBadge } from "./LeaderboardParts";
import styles from "./leaderboard.module.css";

/* The month's prize banner, as on the website (components/leaderboard/PrizeHero.tsx). */

interface Prize {
  id: string;
  month: string;
  prizeName: string;
  prizeImageUrl: string | null;
  updatedAt: string;
}

export interface PrizeHeroData {
  ok: true;
  prize: Prize | null;
  month: string;
  endsAt: string;
  leader: { userId: string; name: string; avatarUrl: string | null; points: number; badge?: MemberBadge | null } | null;
  canEdit: boolean;
  storageReady: boolean;
}

export const PRIZE_KEY = ["leaderboard", "prize"] as const;

const ERROR_MESSAGES: Record<string, string> = {
  prize_name_required: "Add a prize name.",
  prize_name_too_long: "Prize names must be 160 characters or fewer.",
  invalid_prize_month: "Choose a valid competition month.",
  invalid_prize_image_url: "Enter a valid image URL.",
  prize_image_url_must_be_https: "Prize images must use an HTTPS URL.",
  prize_image_url_too_long: "That image URL is too long.",
  prize_storage_unavailable: "Run the leaderboard prize migration before saving.",
  unable_to_save_prize: "The prize could not be saved. Try again.",
};

function countdown(endsAt: string, now: number) {
  const remaining = Math.max(0, new Date(endsAt).getTime() - now);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  return {
    days: Math.floor(remaining / day),
    hours: Math.floor((remaining % day) / hour),
    minutes: Math.floor((remaining % hour) / minute),
  };
}

function monthName(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function monthEndLabel(endsAt: string) {
  const finalDay = new Date(new Date(endsAt).getTime() - 1);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Toronto" }).format(finalDay);
}

export function PrizeHero({ data }: { data: PrizeHeroData }) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMonth, setDraftMonth] = useState("");
  const [draftImageUrl, setDraftImageUrl] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const prize = data.prize;
  const timeLeft = countdown(data.endsAt, now);

  function openEditor() {
    setDraftName(prize?.prizeName ?? "");
    setDraftMonth(prize?.month.slice(0, 7) ?? data.month);
    setDraftImageUrl(prize?.prizeImageUrl ?? "");
    setEditorError(null);
    setEditorOpen(true);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  async function savePrize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prizeName = draftName.trim();
    const prizeImageUrl = draftImageUrl.trim();
    if (!prizeName) return setEditorError(ERROR_MESSAGES.prize_name_required);
    if (prizeName.length > 160) return setEditorError(ERROR_MESSAGES.prize_name_too_long);
    if (prizeImageUrl) {
      try {
        if (new URL(prizeImageUrl).protocol !== "https:") return setEditorError(ERROR_MESSAGES.prize_image_url_must_be_https);
      } catch {
        return setEditorError(ERROR_MESSAGES.invalid_prize_image_url);
      }
    }
    setSaving(true);
    setEditorError(null);
    try {
      const payload = await api<PrizeHeroData>("/api/leaderboard/prize", { method: "PUT", body: { prizeName, prizeImageUrl, month: draftMonth } });
      queryClient.setQueryData(PRIZE_KEY, payload);
      setImageFailed(false);
      setEditorOpen(false);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      setEditorError((code && ERROR_MESSAGES[code]) || ERROR_MESSAGES.unable_to_save_prize);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className={styles.prizeHero} aria-labelledby="leaderboard-prize-title">
        <div className={`${styles.prizeGlow} ${styles.prizeGlowPurple}`} aria-hidden />
        <div className={`${styles.prizeGlow} ${styles.prizeGlowAmber}`} aria-hidden />

        {data.canEdit && (
          <button type="button" className={`ui-button ui-button--secondary ui-button--sm ${styles.prizeEditButton}`} onClick={openEditor}>
            <Pencil aria-hidden size={14} />
            Edit prize
          </button>
        )}

        <div className={styles.prizeHeroCopy}>
          <div className={styles.prizeEyebrow}>
            <span>{monthName(data.month).toUpperCase()} CREATOR CUP</span>
            <i aria-hidden />
            <span>ENDS {monthEndLabel(data.endsAt).toUpperCase()}</span>
          </div>

          <h2 id="leaderboard-prize-title">
            {prize ? (
              <>This month&apos;s top student wins <span>{prize.prizeName}</span></>
            ) : (
              <>This month&apos;s prize is <span>coming soon</span></>
            )}
          </h2>

          <p>
            Earn points by posting, helping others, and finishing lessons. The most active
            student when the clock hits zero takes it home.
          </p>

          <div className={styles.prizeHeroFooter}>
            <div className={styles.prizeCountdown}
              aria-label={`${timeLeft.days} days, ${timeLeft.hours} hours, and ${timeLeft.minutes} minutes remaining`}>
              {([["days", timeLeft.days], ["hrs", timeLeft.hours], ["min", timeLeft.minutes]] as const).map(([label, value]) => (
                <div key={label}>
                  <strong>{String(value).padStart(2, "0")}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            {data.leader ? (
              <div className={styles.prizeLeader}>
                <LbAvatar name={data.leader.name} id={data.leader.userId} src={data.leader.avatarUrl} size={36} />
                <div>
                  <span>Current leader</span>
                  <strong>
                    <MemberName name={data.leader.name} badge={data.leader.badge} size="compact" />
                    <i> · </i>
                    <b>{data.leader.points.toLocaleString()} pts</b>
                  </strong>
                </div>
              </div>
            ) : (
              <div className={`${styles.prizeLeader} ${styles.prizeLeaderEmpty}`}>
                <Sparkles aria-hidden size={18} />
                <div>
                  <span>Current leader</span>
                  <strong>First place is waiting</strong>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.prizeVisual}>
          <div className={styles.prizeVisualHalo} aria-hidden />
          {prize?.prizeImageUrl && !imageFailed ? (
            <img src={prize.prizeImageUrl} alt={prize.prizeName} onError={() => setImageFailed(true)} />
          ) : (
            <div className={styles.prizePlaceholder}>
              <div>{prize ? <Trophy aria-hidden size={34} /> : <ImageIcon aria-hidden size={31} />}</div>
              <strong>{prize?.prizeName ?? "Prize coming soon"}</strong>
              <span>{prize ? "This month’s reward" : "The reveal is on its way"}</span>
            </div>
          )}
        </div>
      </section>

      {editorOpen ? (
        <Modal title="Edit this month’s prize" width={520} onClose={() => { if (!saving) setEditorOpen(false); }}>
          <div className={`lb-web ${styles.prizeEditor}`}>
            <form onSubmit={savePrize}>
              <label>
                <span>Prize name</span>
                <input ref={nameInputRef} value={draftName} onChange={(event) => setDraftName(event.target.value)}
                  maxLength={160} placeholder="e.g. an iPhone 17 Pro" required />
              </label>
              <label>
                <span>Competition month</span>
                <input type="month" value={draftMonth} onChange={(event) => setDraftMonth(event.target.value)} min="2020-01" max="2100-12" required />
              </label>
              <label>
                <span>Prize image URL · optional</span>
                <input type="url" inputMode="url" value={draftImageUrl} onChange={(event) => setDraftImageUrl(event.target.value)}
                  maxLength={2048} placeholder="https://…" />
                <small>HTTPS images only. A premium placeholder appears without one.</small>
              </label>
              {!data.storageReady && <div className={styles.prizeEditorNotice}>Apply the leaderboard prize migration before saving.</div>}
              {editorError && <div className={styles.prizeEditorError} role="alert">{editorError}</div>}
              <footer>
                <button type="button" className="ui-button ui-button--ghost ui-button--md" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="ui-button ui-button--primary ui-button--md" disabled={saving}>{saving ? "Saving…" : "Save prize"}</button>
              </footer>
            </form>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
