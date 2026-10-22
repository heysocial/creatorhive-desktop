import { useEffect, useRef, useState } from "react";
import { Loader2, Play, VideoOff } from "lucide-react";
import { ch } from "../../lib/bridge";
import type { VideoAttachment } from "../../lib/community";

const duration = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

/*
  A message video. Mux videos play here (HLS through hls.js; Chromium has no
  native HLS). Older Cloudflare videos open their player in the browser.
*/
export function VideoPlayer({ video }: { video: VideoAttachment }) {
  const [playing, setPlaying] = useState(false);
  const element = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!playing || !video.hlsUrl || !element.current) return;
    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !element.current) return;
      if (Hls.isSupported()) {
        const instance = new Hls();
        instance.loadSource(video.hlsUrl!);
        instance.attachMedia(element.current);
        hls = instance;
      } else {
        element.current.src = video.hlsUrl!;
      }
      void element.current.play().catch(() => {});
    });
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [playing, video.hlsUrl]);

  if (video.unavailable || video.status === "error") {
    return <div className="video unavailable"><VideoOff />Video unavailable</div>;
  }
  if (video.status === "processing") {
    return (
      <div className="video unavailable processing">
        {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" style={{ opacity: .5 }} /> : null}
        <Loader2 className="spin" style={{ position: "relative" }} />
        <span style={{ position: "relative" }}>Processing{video.processingPct ? ` ${Math.round(video.processingPct)}%` : ""}…</span>
      </div>
    );
  }
  if (playing && video.hlsUrl) {
    return <div className="video"><video ref={element} controls playsInline poster={video.thumbnailUrl ?? undefined} /></div>;
  }
  return (
    <button className="video" onClick={() => (video.hlsUrl ? setPlaying(true) : ch.app.openExternal(video.embedUrl))} title={video.fileName}>
      {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : null}
      <span className="play"><Play /></span>
      {video.durationSeconds ? <span className="dur">{duration(video.durationSeconds)}</span> : null}
    </button>
  );
}
