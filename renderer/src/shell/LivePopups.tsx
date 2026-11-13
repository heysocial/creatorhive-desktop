import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ch } from "../lib/bridge";
import { openPath } from "../lib/links";
import { popupOnScreen, type LivePopup, type LivePopupKind } from "../lib/popups";
import { Avatar } from "../lib/ui";

/** How long a popup stays, unless hovered. */
const SHOW_MS = 5_000;
/** At most this many on screen; the rest wait their turn. */
const MAX_VISIBLE = 3;
/** Matches the slide-out in popups.css. */
const LEAVE_MS = 220;

interface Shown {
  popup: LivePopup;
  leaving: boolean;
}

interface State {
  shown: Shown[];
  /** Arrived while three were showing; each comes in as one leaves. */
  waiting: LivePopup[];
}

type Action =
  | { type: "add"; popup: LivePopup }
  | { type: "leave"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear-waiting" }
  | { type: "clear" };

const EMPTY: State = { shown: [], waiting: [] };

/** Pure, so React may run it twice (it does, in development) without losing a popup. */
function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "add":
      return promote({ ...state, waiting: [...state.waiting, action.popup] });
    case "leave":
      return { ...state, shown: state.shown.map((item) => item.popup.id === action.id ? { ...item, leaving: true } : item) };
    case "remove":
      return promote({ ...state, shown: state.shown.filter((item) => item.popup.id !== action.id) });
    case "clear-waiting":
      return { ...state, waiting: [] };
    case "clear":
      return EMPTY;
  }
}

function promote(state: State): State {
  const shown = [...state.shown];
  const waiting = [...state.waiting];
  while (shown.filter((item) => !item.leaving).length < MAX_VISIBLE && waiting.length > 0) {
    shown.unshift({ popup: waiting.shift()!, leaving: false });
  }
  return { shown, waiting };
}

/**
 * Live popups, as on the website (components/popups/LivePopups.tsx): top
 * right, newest on top, three at most, five seconds each unless the pointer is
 * on one. The main process decides whether the app may show one at all; this
 * skips what is already on screen.
 */
export function LivePopups() {
  const [{ shown }, dispatch] = useReducer(reduce, EMPTY);
  const seen = useRef(new Set<string>());

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "leave", id });
    window.setTimeout(() => dispatch({ type: "remove", id }), LEAVE_MS);
  }, []);

  useEffect(() => ch.app.onPopup((popup) => {
    if (!popup || seen.current.has(popup.id)) return;
    seen.current.add(popup.id);
    if (popupOnScreen(popup)) return;
    dispatch({ type: "add", popup });
  }), []);

  // Locking the app clears them: the lock screen never shows who or what.
  useEffect(() => ch.app.onLocked((locked) => {
    if (!locked) return;
    dispatch({ type: "clear" });
  }), []);

  if (shown.length === 0) return null;
  return (
    <div className="lp-stack" role="region" aria-label="Notifications" aria-live="polite">
      {shown.map((item) => (
        <PopupCard
          key={item.popup.id}
          popup={item.popup}
          leaving={item.leaving}
          onClose={() => dismiss(item.popup.id)}
          onOpen={() => {
            dismiss(item.popup.id);
            void openPath(item.popup.href);
          }}
        />
      ))}
    </div>
  );
}

function PopupCard({ popup, leaving, onClose, onOpen }: {
  popup: LivePopup;
  leaving: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const firstName = popup.actor.name.split(/\s+/)[0] || popup.actor.name;
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`lp-popup${leaving ? " leaving" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${popup.actor.name} ${popup.text}. Open`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="lp-avatar">
        <Avatar name={popup.actor.name} src={popup.actor.avatarUrl} seed={popup.actor.id} size={40} />
        <span className="lp-kind" data-kind={popup.kind}><KindIcon kind={popup.kind} /></span>
      </div>
      <div className="lp-text">
        <div className="lp-line">
          <span className="lp-who">{firstName}</span>
          <span className="lp-what">{popup.text}</span>
          <span className="lp-ago">{timeAgo(popup.at)}</span>
        </div>
        {popup.preview ? <div className="lp-preview">“{popup.preview}”</div> : null}
      </div>
      <button
        type="button"
        className="lp-close"
        aria-label="Close"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
      {!leaving ? <span className="lp-timer" style={{ animationDuration: `${SHOW_MS}ms` }} onAnimationEnd={onClose} /> : null}
    </div>
  );
}

function KindIcon({ kind }: { kind: LivePopupKind }) {
  if (kind === "reaction") {
    return <svg viewBox="0 0 16 16" aria-hidden><path d="M8 14s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.9A3.3 3.3 0 0 1 14 6c0 4.4-6 8-6 8z" /></svg>;
  }
  if (kind === "mention") {
    return <svg viewBox="0 0 16 16" aria-hidden><path d="M8 1.5a6.5 6.5 0 1 0 3.3 12.1l-.7-1.2A5.1 5.1 0 1 1 13.1 8v.7c0 .8-.5 1.3-1.1 1.3s-1-.5-1-1.3V4.6H9.7v.6A3.3 3.3 0 1 0 10.1 10a2.4 2.4 0 0 0 4.4-1.3V8A6.5 6.5 0 0 0 8 1.5zm0 8.4A1.9 1.9 0 1 1 8 6a1.9 1.9 0 0 1 0 3.9z" /></svg>;
  }
  if (kind === "video") {
    // A clapperboard: the personal video editor (uploads, versions, reviews).
    return <svg viewBox="0 0 16 16" aria-hidden><path d="M2 6.5h12V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM1.8 5.3l-.4-1.5a1 1 0 0 1 .7-1.2L11.8.1a1 1 0 0 1 1.2.7l.4 1.5z" /></svg>;
  }
  if (kind === "dm") {
    return <svg viewBox="0 0 16 16" aria-hidden><path d="M1.5 3h13v10h-13zM2.8 4.4 8 8.3l5.2-3.9z" /></svg>;
  }
  return <svg viewBox="0 0 16 16" aria-hidden><path d="M2 3h12v8H6l-4 3z" /></svg>;
}

function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
