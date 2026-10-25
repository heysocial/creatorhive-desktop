import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Modal } from "../views/hub/parts";

/*
  Reporting a post or a comment to the CreatorHive team, through the website's
  /api/moderation/reports. The reasons, their order and the wording are the
  website's ReportDialog (and the iPhone's), so a member sees one list wherever
  they report from. A reason is required and the note is not.
*/

export type ReportTarget = { type: "post" | "comment" | "message" | "user"; id: string; name?: string };

const REASONS = [
  ["harassment", "Harassment or bullying"],
  ["hate_or_abuse", "Hate or abuse"],
  ["sexual_content", "Sexual content"],
  ["violence_or_threats", "Violence or threats"],
  ["spam_or_scam", "Spam or a scam"],
  ["privacy", "Shares private information"],
  ["other", "Something else"],
] as const;

const NOUN = { post: "post", comment: "comment", message: "message", user: "member" };

export function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"filed" | "already" | null>(null);
  const noun = NOUN[target.type];
  const close = () => { if (!sending) onClose(); };

  async function send() {
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/moderation/reports", { method: "POST", body: { targetType: target.type, targetId: target.id, reason, note: note.trim() ? note.trim().slice(0, 1000) : undefined } });
      setOutcome("filed");
    } catch (e) {
      // Already reported isn't a failure: it's with the team, and saying so reassures.
      if (e instanceof ApiError && e.status === 409) setOutcome("already");
      else if (e instanceof ApiError && e.status === 429) setError("You’ve sent a lot of reports in the last hour. The ones you already sent are with the team.");
      else setError("That report didn’t send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (outcome) {
    return (
      <Modal title={outcome === "already" ? "Already reported" : "Report sent"} onClose={onClose} width={420} foot={<button className="btn honey" onClick={onClose}>Done</button>}>
        <p className="report-sent"><Check />{outcome === "already" ? "You’ve already reported this. It’s with the team." : "Reported. The team reviews every report."}</p>
      </Modal>
    );
  }

  return (
    <Modal title={`Report this ${noun}`} onClose={close} width={440} foot={<>
      <button className="btn" onClick={close} disabled={sending}>Cancel</button>
      <button className="btn honey" disabled={!reason || sending} onClick={() => void send()}>{sending ? <Loader2 className="spin" /> : null}{sending ? "Sending…" : "Send report"}</button>
    </>}>
      <p className="muted report-intro">{target.name
        ? `Your report goes to the CreatorHive team. ${target.name} is not told who reported them.`
        : "Your report goes to the CreatorHive team, and is not shared with the person you are reporting."}</p>
      {error ? <div className="signin-error">{error}</div> : null}
      {REASONS.map(([value, label]) => (
        <label key={value} className="radio-row">
          <input type="radio" name="report-reason" checked={reason === value} disabled={sending} onChange={() => { setReason(value); setError(null); }} />
          <span>{label}</span>
        </label>
      ))}
      <label className="report-note">
        <span className="muted">Anything else the team should know? Optional.</span>
        <textarea className="field area" rows={3} maxLength={1000} value={note} disabled={sending} placeholder="Add context" onChange={(e) => setNote(e.target.value)} />
      </label>
    </Modal>
  );
}
