import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, ApiError, queryClient } from "../../lib/api";
import { useAdminAccess } from "../../lib/admin";
import type { CommunityEvent } from "../../lib/events";
import { Modal } from "../hub/parts";
import "../../styles/admin-events-misc.css";

/*
  What owner and team do to community events, as on the website's Events page
  (app/events/page.tsx): New event, and Edit / Delete on each one. Coaching
  calls come from the calendars and can't be changed here or there. The
  server checks the role too (/api/events, /api/events/[id]).
*/

/** Owner or team: the website's `canCreate`. */
export function useCanManageEvents() {
  return useAdminAccess().data?.team === true;
}

/** A Date as a datetime-local value, in this Mac's time zone. */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ["events", "community"] });

function messageOf(error: unknown) {
  return error instanceof ApiError && error.code && !/^HTTP \d+$/.test(error.code) ? error.code : "Something went wrong. Try again.";
}

export function NewEventButton({ onCreated }: { onCreated: (event: { id: string; startsAt: string }) => void }) {
  const [open, setOpen] = useState(false);
  if (!useCanManageEvents()) return null;
  return (
    <>
      <button className="btn honey" onClick={() => setOpen(true)}><Plus />New event</button>
      {open ? <CreateEventModal onClose={() => setOpen(false)} onCreated={onCreated} /> : null}
    </>
  );
}

function CreateEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: (event: { id: string; startsAt: string }) => void }) {
  // Tomorrow at this time, for an hour: the website's starting values.
  const [tomorrow] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(tomorrow));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(tomorrow.getTime() + 60 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { event: created } = await api<{ event: { id: string; startsAt: string } }>("/api/events", {
        method: "POST",
        body: {
          title, description: description || null, locationUrl: locationUrl || null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
      });
      await refresh();
      onCreated(created);
      onClose();
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  }

  return (
    <Modal title="New event" width={480} onClose={() => { if (!busy) onClose(); }}>
      <form className="evx-form" onSubmit={submit}>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required autoFocus />
        <textarea className="field area" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} />
        <input className="field" value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} placeholder="Meeting URL (Zoom, Meet, etc)" />
        <div className="evx-times">
          <label><span>Starts</span><input className="field" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></label>
          <label><span>Ends</span><input className="field" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></label>
        </div>
        {error ? <div className="evx-error" role="alert">{error}</div> : null}
        <button type="submit" className="btn honey lg" disabled={!title.trim() || busy}>{busy ? "Creating…" : "Create event"}</button>
      </form>
    </Modal>
  );
}

/** Edit and Delete under a community event, for owner and team. */
export function EventStaffActions({ event, onDeleted }: { event: CommunityEvent; onDeleted: () => void }) {
  const canManage = useCanManageEvents();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage || event.source !== "community") return null;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${event.id}`, { method: "DELETE" });
      onDeleted();
      await refresh();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="evx-staff">
      <div className="evx-staff-row">
        {confirmingDelete ? (
          <>
            <span className="evx-ask">Delete?</span>
            <button className="btn evx-danger" disabled={busy} onClick={() => void remove()}>Yes</button>
            <button className="btn" disabled={busy} onClick={() => setConfirmingDelete(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button>
            <button className="btn" onClick={() => { setEditing(false); setConfirmingDelete(true); }}>Delete</button>
          </>
        )}
      </div>
      {error ? <div className="evx-error" role="alert">{error}</div> : null}
      {editing ? <EditEventInline key={event.id} event={event} onSaved={() => setEditing(false)} /> : null}
    </div>
  );
}

function EditEventInline({ event, onSaved }: { event: CommunityEvent; onSaved: () => void }) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [locationUrl, setLocationUrl] = useState(event.locationUrl ?? "");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date(event.startsAt)));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(event.endsAt)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/events/${event.id}`, {
        method: "PATCH",
        body: {
          title, description, locationUrl,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
      });
      await refresh();
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="evx-form evx-inline">
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <textarea className="field area" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} aria-label="Description" />
      <input className="field" value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} placeholder="Meeting URL" />
      <div className="evx-times">
        <input className="field" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-label="Starts" />
        <input className="field" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} aria-label="Ends" />
      </div>
      {error ? <div className="evx-error" role="alert">{error}</div> : null}
      <button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
