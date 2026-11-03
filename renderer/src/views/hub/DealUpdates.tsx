import { Fragment, useRef, useState } from "react";
import { CalendarDays, Pencil, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "../../lib/api";
import { localToday, shortDay } from "../../lib/hub";
import { openLink } from "../../lib/html";
import { splitLinks } from "../../lib/linkify";

/*
  A deal's dated updates ("Oct 25 · Brand approved the draft"), newest first,
  with a box to add one — Kinzi's request, the same data as the website's
  components/hub/DealUpdates.tsx. The day starts on today and can be changed;
  an update is edited in place (⌘↩ saves, Esc cancels) or deleted after a
  confirm. Adding one never moves the deal or resets its 7-day warning.
*/

export interface DealUpdate { id: string; body: string; occurredOn: string; createdAt: string; updatedAt: string; userId: string | null }

const MAX = 500;

const sorted = (list: DealUpdate[]) => [...list].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

function errorText(error: unknown, fallback: string) {
  const message = error instanceof ApiError ? (error.data as { message?: unknown } | null)?.message : null;
  return typeof message === "string" && message ? message : fallback;
}

/** Plain text with links that open in the browser (or in the app, for our own pages). */
export function Linkified({ text }: { text: string }) {
  return <>{splitLinks(text).map((part, i) => part.href
    ? <a key={i} href={part.href} className="text-link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openLink(part.href!); }}>{part.text}</a>
    : <Fragment key={i}>{part.text}</Fragment>)}</>;
}

export function DealUpdates({ dealId }: { dealId: string }) {
  const key = ["hub", "updates", dealId];
  const { data, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api<{ updates: DealUpdate[]; canEdit: boolean }>(`/api/hub/deals/${dealId}/updates`),
  });
  const [draft, setDraft] = useState("");
  const [day, setDay] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; day: string; saving: boolean } | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  const updates = sorted(data?.updates ?? []);
  const canEdit = data?.canEdit === true;
  const setList = (next: (list: DealUpdate[]) => DealUpdate[]) =>
    queryClient.setQueryData<{ updates: DealUpdate[]; canEdit: boolean }>(key, (old) => old && { ...old, updates: sorted(next(old.updates)) });

  if (isError && !data) return <section className="dp-sec"><span className="section-label">Updates</span><p className="faint dp-empty">Updates didn’t load. <button className="link" onClick={() => void refetch()}>Try again</button></p></section>;
  if (!data || (!canEdit && updates.length === 0)) return null;

  const text = draft.trim();
  const canAdd = text.length > 0 && [...text].length <= MAX && !busy;
  const today = localToday();

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const { update } = await api<{ update: DealUpdate }>(`/api/hub/deals/${dealId}/updates`, { method: "POST", body: { body: text, occurred_on: day } });
      setList((list) => [update, ...list]);
      setDraft("");
      setDay(localToday());
    } catch (e) {
      setError(errorText(e, "That update didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing || editing.saving) return;
    const body = editing.body.trim();
    if (!body || [...body].length > MAX) return;
    setEditing({ ...editing, saving: true });
    setError(null);
    try {
      const { update } = await api<{ update: DealUpdate }>(`/api/hub/deals/${dealId}/updates/${editing.id}`, { method: "PATCH", body: { body, occurred_on: editing.day } });
      setList((list) => list.map((item) => (item.id === update.id ? update : item)));
      setEditing(null);
    } catch (e) {
      setError(errorText(e, "That didn't save. Try again."));
      setEditing((current) => current && { ...current, saving: false });
    }
  }

  async function remove(update: DealUpdate) {
    if (!window.confirm("Delete this update?\n\nThis can’t be undone.")) return;
    setError(null);
    try {
      await api(`/api/hub/deals/${dealId}/updates/${update.id}`, { method: "DELETE" });
      setList((list) => list.filter((item) => item.id !== update.id));
      setEditing((current) => (current?.id === update.id ? null : current));
    } catch (e) {
      setError(errorText(e, "That didn't delete. Try again."));
    }
  }

  return (
    <section className="dp-sec">
      <div className="dp-sec-head"><span className="section-label">Updates</span>{updates.length ? <span className="faint">{updates.length}</span> : null}</div>
      {canEdit ? (
        <div className="du-composer">
          <textarea
            className="du-input"
            rows={1}
            placeholder="Add an update"
            aria-label="Add an update"
            value={draft}
            maxLength={MAX}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void add(); } }}
          />
          <div className="du-row">
            <button className="du-day" onClick={() => { try { dateInput.current?.showPicker(); } catch { dateInput.current?.focus(); } }}>
              <CalendarDays />{day === today ? `Today, ${shortDay(today)}` : shortDay(day)}
            </button>
            <input ref={dateInput} type="date" className="du-hidden-date" aria-label="Update date" tabIndex={-1} value={day} onChange={(e) => setDay(e.target.value || localToday())} />
            <span className="du-end">
              {draft.length >= MAX - 100 ? <span className="faint du-count">{draft.length}/{MAX}</span> : null}
              <button className="btn honey" disabled={!canAdd} onClick={() => void add()}>Add</button>
            </span>
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {updates.length ? (
        <ol className="du-list">
          {updates.map((update, index) => editing?.id === update.id ? (
            <li key={update.id} className="du-entry du-editing" data-latest={index === 0 || undefined}>
              <label className="du-edit-date">Date <input type="date" value={editing.day} onChange={(e) => e.target.value && setEditing({ ...editing, day: e.target.value })} /></label>
              <textarea
                className="du-edit-input"
                rows={2}
                autoFocus
                aria-label="Update"
                maxLength={MAX}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                  if (e.key === "Enter" && e.metaKey) { e.preventDefault(); void save(); }
                }}
              />
              <div className="du-row">
                <button className="link du-delete" disabled={editing.saving} onClick={() => void remove(update)}>Delete</button>
                <span className="du-end">
                  <button className="btn" disabled={editing.saving} onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn honey" disabled={editing.saving || !editing.body.trim()} onClick={() => void save()}>Save</button>
                </span>
              </div>
            </li>
          ) : (
            <li key={update.id} className="du-entry" data-latest={index === 0 || undefined}>
              <time className="du-date" dateTime={update.occurredOn}>{shortDay(update.occurredOn)}</time>
              <span className="du-body selectable"><Linkified text={update.body} /></span>
              {canEdit ? (
                <span className="du-acts">
                  <button aria-label="Edit update" title="Edit" onClick={() => setEditing({ id: update.id, body: update.body, day: update.occurredOn, saving: false })}><Pencil /></button>
                  <button aria-label="Delete update" title="Delete" onClick={() => void remove(update)}><Trash2 /></button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
