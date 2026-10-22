import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { VoiceMemo } from "../../lib/community";

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A voice memo: play, the waveform filling as it plays, and the time. */
export function VoicePlayer({ memo }: { memo: VoiceMemo }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const bars = memo.waveform.length ? memo.waveform : Array.from({ length: 40 }, () => 0.35);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const tick = () => setAt(el.currentTime);
    const end = () => { setPlaying(false); setAt(0); };
    el.addEventListener("timeupdate", tick);
    el.addEventListener("ended", end);
    return () => { el.removeEventListener("timeupdate", tick); el.removeEventListener("ended", end); };
  }, []);

  if (!memo.url) return <div className="voice">Voice memo unavailable</div>;
  const progress = memo.durationSeconds ? at / memo.durationSeconds : 0;
  return (
    <div className="voice">
      <button className="vplay" aria-label={playing ? "Pause" : "Play"} onClick={() => {
        const el = audio.current!;
        if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
      }}>{playing ? <Pause /> : <Play />}</button>
      <span className="wave">
        {bars.map((level, i) => <i key={i} className={i / bars.length < progress ? "on" : ""} style={{ height: `${Math.max(12, level * 100)}%` }} />)}
      </span>
      <span className="vtime">{time(playing || at ? at : memo.durationSeconds)}</span>
      <audio ref={audio} src={memo.url} preload="none" />
    </div>
  );
}
