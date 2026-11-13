import { useEffect, useRef, type RefObject } from "react";
import type { EditPlayback } from "../../lib/videoEdits";

/*
  The personal video editor's player: the signed Mux stream (HLS through
  hls.js; Chromium plays no HLS by itself) while it exists, else the
  full-quality file straight from storage (`viewUrl`, a presigned link).
*/

export interface PlayerSource {
  playback: EditPlayback | null;
  viewUrl: string;
}

/** Attaches a source to a <video>: hls.js for the Mux stream, the plain file otherwise. */
export function useVideoSource(video: RefObject<HTMLVideoElement | null>, source: PlayerSource | null, autoPlay = false) {
  const hlsUrl = source?.playback?.hlsUrl ?? null;
  const fileUrl = source?.viewUrl ?? null;
  useEffect(() => {
    const element = video.current;
    if (!element || (!hlsUrl && !fileUrl)) return;
    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    const playFile = () => {
      if (destroyed || !fileUrl) return;
      element.src = fileUrl;
      if (autoPlay) void element.play().catch(() => {});
    };
    if (hlsUrl) {
      void import("hls.js").then(({ default: Hls }) => {
        if (destroyed) return;
        if (!Hls.isSupported()) { playFile(); return; }
        const instance = new Hls();
        hls = instance;
        // A stream that can't load (still preparing, link expired): the file plays instead.
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          instance.destroy();
          hls = null;
          playFile();
        });
        instance.loadSource(hlsUrl);
        instance.attachMedia(element);
        if (autoPlay) void element.play().catch(() => {});
      }).catch(playFile);
    } else {
      playFile();
    }
    return () => {
      destroyed = true;
      hls?.destroy();
      element.removeAttribute("src");
      element.load();
    };
  }, [video, hlsUrl, fileUrl, autoPlay]);
}

/** A still for a video: Mux's thumbnail when there is one, else the file's first frame. */
export function VideoStill({ thumbnailUrl, fileUrl, className = "", label }: { thumbnailUrl?: string | null; fileUrl?: string | null; className?: string; label?: string }) {
  return (
    <span className={`ve-still ${className}`}>
      {thumbnailUrl ? <img src={thumbnailUrl} alt="" loading="lazy" />
        : fileUrl ? <video src={`${fileUrl}#t=0.1`} preload="metadata" muted playsInline />
        : null}
      {label ? <span className="ve-still-label">{label}</span> : null}
    </span>
  );
}

/** A plain player with the system controls, for a quick look at an original or a version. */
export function QuickPlayer({ source, title, onClose }: { source: PlayerSource; title: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useVideoSource(video, source, true);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="scrim center ve-quick-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ve-quick" role="dialog" aria-label={title}>
        <div className="ve-quick-head"><b>{title}</b><button className="btn" onClick={onClose}>Close</button></div>
        <video ref={video} controls playsInline />
      </div>
    </div>
  );
}
