import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ExternalLink, X } from "lucide-react";
import { ch } from "../lib/bridge";
import type { MeAccess } from "../lib/access";
import { useLayer } from "../views/hub/parts";

/*
  "Book a call with our team" inside the app. The Weekend Starter's "Talk to
  our team" opens the Cal.com booking (the server's `upgradeUrl`, with the
  member's name and email filled in) in a pop-up over the window instead of the
  browser. Every other plan, or an unknown one, opens the browser as before.

  The page is a cross-origin <iframe> in the main window:
  - index.html's CSP lets frames come from https://cal.com and https://app.cal.com
    only (besides the lesson players that were already there);
  - the iframe's `sandbox` has no top navigation, so it can't move the window;
  - the preload (window.ch) runs in the main frame only, and a cross-origin
    frame can't reach the parent's window, so Cal.com never sees the bridge;
  - the app's account cookies live in the persist:creatorhive session, used by
    the main process only — this window's session has none to share;
  - links it opens in a new window go to the browser (setWindowOpenHandler),
    and it gets no permissions but fullscreen (configurePermissions).
  Esc pressed inside the frame never reaches this page, so the main process
  sends `window:escape` when the key goes to a sub-frame.
*/

const BOOKING_HOSTS = new Set(["cal.com", "app.cal.com"]);

/** A Cal.com page we'll show in the app (https, cal.com or app.cal.com); null otherwise. */
export function bookingUrl(url: string, dark: boolean): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !BOOKING_HOSTS.has(parsed.hostname)) return null;
    parsed.searchParams.set("theme", dark ? "dark" : "light");
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Shows the booking pop-up (BookingHost listens). */
export function openBooking(url: string) {
  window.dispatchEvent(new CustomEvent<string>("ch:booking", { detail: url }));
}

/**
 * What "Talk to our team" does: on The Weekend Starter (plan "first3"), the
 * booking pop-up when the link is a Cal.com page; otherwise the browser.
 */
export function talkToTeam(access: MeAccess | undefined, url: string) {
  if (access?.plan === "first3" && bookingUrl(url, false)) openBooking(url);
  else ch.app.openExternal(url);
}

function prefersDark() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function BookingDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [src] = useState(() => bookingUrl(url, prefersDark()));
  useLayer(onClose, box);
  // Esc while the booking page has focus: the main process tells us.
  useEffect(() => ch.window.onEscape?.(() => {
    if (document.activeElement === frame.current) onClose();
  }), [onClose]);
  if (!src) return null;
  return createPortal(
    <div className="scrim center booking-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="modal booking" role="dialog" aria-modal="true" aria-label="Book a call with our team" tabIndex={-1}>
        <div className="modal-head booking-head">
          <CalendarDays aria-hidden />
          <span>Book a call with our team</span>
          <button className="iconbtn" onClick={() => ch.app.openExternal(url)} title="Open in your browser" aria-label="Open in your browser"><ExternalLink /></button>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="booking-body">
          {loaded ? null : <div className="booking-loading">Loading the calendar…</div>}
          <iframe
            ref={frame}
            title="Book a call with our team"
            src={src}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            allow=""
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once in the app beside UpgradeHost: openBooking() shows the pop-up from anywhere. */
export function BookingHost() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string") setUrl(detail);
    };
    window.addEventListener("ch:booking", show);
    return () => window.removeEventListener("ch:booking", show);
  }, []);
  return url ? <BookingDialog key={url} url={url} onClose={() => setUrl(null)} /> : null;
}
