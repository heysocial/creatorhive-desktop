import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileWarning, Inbox, Paperclip, RefreshCw, Trash2, UserX } from "lucide-react";
import { api, ApiError, queryClient } from "../../lib/api";
import { useAdminAccess } from "../../lib/admin";
import { ch } from "../../lib/bridge";
import { Avatar } from "../../lib/ui";
import "../../styles/admin-metrics-moderation.css";

/*
  Admin → Moderation: the website's /admin/moderation (components/moderation/ModerationQueue.tsx).
  Reports and block signals, filtered by status, and on an open one: remove
  the content, suspend the member, or dismiss, each with an optional
  resolution note (the website's defaults fill in when it's empty). Owner
  only, as every /api/moderation route checks. After each action the queue
  and the Admin badge (open reports) refresh.
*/

type Filter = "open" | "actioned" | "dismissed" | "all";
type Resolution = "actioned" | "dismissed";

interface Person { id: string; name: string; avatarUrl: string | null; role: string; status: string }
interface Attachment { url: string; name: string | null; mimeType: string | null; size: number | null }

interface Report {
  id: string;
  source: "report" | "block";
  targetType: "post" | "comment" | "message" | "user";
  targetId: string;
  targetAuthorId: string | null;
  reason: string;
  note: string | null;
  status: "open" | "actioned" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  bodyText: string;
  attachments: Attachment[];
  reporter: Person;
  targetAuthor: Person | null;
}

interface Queue { reports: Report[]; counts: Record<Filter, number> }

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

function formatAge(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatBytes(value: number | null) {
  if (value == null || value < 0) return null;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** The server's error when it sent one, else ours (the website's responseError). */
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.code && !error.code.startsWith("HTTP ") ? error.code : fallback;
}

/** A call where one failing status is still an answer (already gone, already inactive): its status, or throws. */
async function call(path: string, method: string, answer: number, fallback: string) {
  try {
    await api(path, { method });
    return 200;
  } catch (error) {
    if (error instanceof ApiError && error.status === answer) return answer;
    throw new Error(errorText(error, fallback));
  }
}

export function AdminModeration(_props: { id?: string }) {
  const owner = useAdminAccess().data?.owner ?? false;
  const [filter, setFilter] = useState<Filter>("open");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const queue = useQuery({
    queryKey: ["admin", "moderation", filter],
    enabled: owner,
    staleTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => api<Queue>(`/api/moderation/reports?status=${filter}`),
  });
  const data = queue.data;
  const loading = queue.isFetching;
  const loadError = queue.isError ? errorText(queue.error, "Could not load reports.") : null;

  async function resolve(report: Report, status: Resolution, fallbackNote: string) {
    const note = notes[report.id]?.trim() || fallbackNote;
    try {
      await api(`/api/moderation/reports/${report.id}`, { method: "PATCH", body: { status, note } });
    } catch (resolveError) {
      throw new Error(errorText(resolveError, "Could not resolve report."));
    }
  }

  async function runAction(report: Report, action: "dismiss" | "remove" | "suspend") {
    if (pendingId) return;
    setPendingId(report.id);
    setError(null);
    setNotice(null);
    try {
      if (action === "remove") {
        const endpoint = report.targetType === "post" ? `/api/posts/${report.targetId}` : `/api/messages/${report.targetId}`;
        const status = await call(endpoint, "DELETE", 404, "Could not remove content.");
        await resolve(report, "actioned", status === 404 ? "Reported content was already unavailable at review." : "Reported content removed by moderation.");
        setNotice("Content removed and report actioned.");
      } else if (action === "suspend") {
        if (!report.targetAuthorId) throw new Error("This member is no longer available.");
        const status = await call(`/api/moderation/users/${report.targetAuthorId}/suspend`, "POST", 409, "Could not suspend member.");
        await resolve(report, "actioned", status === 409 ? "Reported member was already inactive at review." : "Reported member suspended by moderation.");
        setNotice("Member suspended and report actioned.");
      } else {
        await resolve(report, "dismissed", "Reviewed — no policy action required.");
        setNotice("Report dismissed.");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not complete that action.");
    } finally {
      // The queue, its counts, and the open-reports badge on the rail and sidebar.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin", "moderation"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "summary"] }),
      ]);
      setPendingId(null);
    }
  }

  if (!owner) return <div className="page admx"><div className="admx-scroll"><p className="mx-empty">Moderation is the owner's alone.</p></div></div>;

  const reports = data?.reports ?? [];

  return (
    <div className="page admx">
      <div className="admx-scroll">
        <div className="md">
          <header className="md-header">
            <div>
              <span className="md-eyebrow">Trust &amp; Safety</span>
              <h2>Moderation queue</h2>
              <p>Review reports and block signals, remove harmful content, and protect the community.</p>
            </div>
            <div className="md-open-metric" aria-label={`${data?.counts.open ?? 0} open moderation items`}>
              <strong className="admx-mono">{data?.counts.open ?? 0}</strong>
              <span>open</span>
            </div>
          </header>

          <div className="md-toolbar">
            <div className="ui-segmented md-filters" role="group" aria-label="Filter moderation reports">
              {FILTERS.map((item) => (
                <button key={item.value} type="button" className="ui-chip" aria-pressed={filter === item.value} onClick={() => { setFilter(item.value); setNotice(null); setError(null); }}>
                  <span>{item.label}</span>
                  <span className="admx-mono">{data?.counts[item.value] ?? 0}</span>
                </button>
              ))}
            </div>
            <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => void queue.refetch()} disabled={loading} aria-label="Refresh moderation queue">
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          </div>

          <div className="md-feedback" aria-live="polite">
            {error ?? loadError ? <p className="md-error">{error ?? loadError}</p> : null}
            {notice ? <p className="md-notice">{notice}</p> : null}
          </div>

          {loading && !data ? (
            <div className="md-list" aria-label="Loading reports" aria-busy="true">
              {[0, 1, 2].map((key) => <div key={key} className="skeleton" style={{ height: 260, borderRadius: 18 }} />)}
            </div>
          ) : null}

          {!loading && queue.isError && !data ? (
            <Empty title="Reports could not load" description="Try refreshing the moderation queue." icon={<AlertTriangle size={22} />}
              action={{ label: "Try again", onClick: () => void queue.refetch() }} />
          ) : null}

          {data && reports.length === 0 ? (
            <Empty
              title={filter === "open" ? "Queue clear" : `No ${filter} moderation items`}
              description={filter === "open" ? "There are no reports or block signals waiting for review." : "Nothing matches this filter yet."}
              icon={<Inbox size={23} />}
            />
          ) : null}

          {data && reports.length > 0 ? (
            <section className="md-list" aria-label={`${titleCase(filter)} moderation items`}>
              {reports.map((report) => {
                const busy = pendingId === report.id;
                const canRemove = report.targetType === "post" || report.targetType === "message";
                const canSuspend = report.targetAuthor?.status === "active" && report.targetAuthor.role !== "owner" && report.targetAuthor.role !== "team";
                return (
                  <article key={report.id} className="md-card" aria-busy={busy || undefined}>
                    <header className="md-card-header">
                      <div className="md-reporter">
                        <Avatar name={report.reporter.name} seed={report.reporter.id} src={report.reporter.avatarUrl} size={34} />
                        <div>
                          <strong>{report.reporter.name}</strong>
                          <span>{report.source === "block" ? `blocked ${report.targetAuthor?.name || "a member"}` : `reported ${report.targetType}`} · {formatAge(report.createdAt)}</span>
                        </div>
                      </div>
                      <span className={`md-status md-status-${report.status}`}>{report.status}</span>
                    </header>

                    <div className="md-reason-row">
                      <FileWarning size={15} aria-hidden />
                      <strong>{report.source === "block" ? "Block signal" : titleCase(report.reason)}</strong>
                      {report.source !== "block" && report.targetAuthor ? <span>by {report.targetAuthor.name}</span> : null}
                    </div>

                    <div className="md-evidence">
                      {report.bodyText ? <p className="selectable">{report.bodyText}</p> : <p className="md-no-body">No text in this report.</p>}
                      {report.attachments.length > 0 ? (
                        <div className="md-attachments">
                          {report.attachments.map((attachment) => (
                            <button key={attachment.url} type="button" onClick={() => ch.app.openExternal(attachment.url)}>
                              <Paperclip size={13} aria-hidden />
                              <span>{attachment.name || "View attachment"}</span>
                              {formatBytes(attachment.size) ? <small>{formatBytes(attachment.size)}</small> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {report.note ? <div className="md-member-note"><span>Member note</span><p className="selectable">{report.note}</p></div> : null}

                    {report.status === "open" ? (
                      <div className="md-triage">
                        <label htmlFor={`resolution-note-${report.id}`}>Resolution note <span>optional—defaults are provided</span></label>
                        <textarea
                          id={`resolution-note-${report.id}`}
                          value={notes[report.id] ?? ""}
                          maxLength={1000}
                          rows={2}
                          placeholder="Add context for the audit trail…"
                          onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                          disabled={busy}
                        />
                        <div className="md-actions">
                          {canRemove ? (
                            <ActionButton variant="destructive" busy={busy} onClick={() => void runAction(report, "remove")}><Trash2 size={14} aria-hidden /> Remove content</ActionButton>
                          ) : null}
                          {canSuspend ? (
                            <ActionButton variant="secondary" busy={busy} onClick={() => void runAction(report, "suspend")}><UserX size={14} aria-hidden /> Suspend member</ActionButton>
                          ) : null}
                          <ActionButton variant="ghost" busy={busy} onClick={() => void runAction(report, "dismiss")}><CheckCircle2 size={14} aria-hidden /> Dismiss</ActionButton>
                        </div>
                      </div>
                    ) : (
                      <div className="md-resolution">
                        <CheckCircle2 size={15} aria-hidden />
                        <span>{report.resolutionNote || "Reviewed"}</span>
                        {report.resolvedAt ? <small>{formatAge(report.resolvedAt)}</small> : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The website's Button: while busy, a spinner takes the icon's place and it can't be pressed. */
function ActionButton({ variant, busy, onClick, children }: { variant: "destructive" | "secondary" | "ghost"; busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`ui-button ui-button--${variant} ui-button--sm`} disabled={busy} aria-busy={busy || undefined} onClick={onClick}>
      {busy ? <span className="admx-spinner" aria-hidden /> : null}{children}
    </button>
  );
}

function Empty({ title, description, icon, action }: { title: string; description: string; icon: React.ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="ui-empty-state">
      <div className="ui-empty-state__icon">{icon}</div>
      <div className="ui-empty-state__title">{title}</div>
      <div className="ui-empty-state__description">{description}</div>
      {action ? <button type="button" className="ui-button ui-button--primary ui-button--sm" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  );
}
