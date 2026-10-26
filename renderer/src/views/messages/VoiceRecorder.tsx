import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal, Square, Trash2 } from "lucide-react";
import { ch } from "../../lib/bridge";
import { rateLimitMessage } from "../../lib/api";
import { VoicePlayer } from "./VoicePlayer";

/*
  A voice memo, recorded the way the website records one (lib/messages/
  voice-recording.ts): AAC in an M4A, up to five minutes, with a 64-level
  waveform, sent to /api/{dms|channels}/<id>/voice. Stop leaves the take to
  listen back to before Send or the bin, as the website's recorder does; Send
  while recording sends at once.
*/

const MAX_SECONDS = 300;
const AAC_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4;codecs=mp4a", "audio/aac"];
const pickType = () => AAC_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : null);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Take { blob: Blob; url: string; type: string; duration: number; waveform: number[] }

export function VoiceRecorder({ path, body, parentMessageId, onSent, onCancel }: {
  path: string;
  body: string;
  parentMessageId?: string | null;
  onSent: (message: unknown) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<"starting" | "recording" | "review" | "sending" | "error">("starting");
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const allLevels = useRef<number[]>([]);
  const started = useRef(0);
  const finish = useRef<"send" | "review" | "cancel">("cancel");
  const mic = useRef<MediaStream | null>(null);

  // The take's address lives until it's sent or thrown away.
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    const type = pickType();
    if (!type) { setState("error"); setError("This Mac can't record AAC audio."); return; }
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.current = stream;
      } catch {
        setState("error");
        setError("The Mac blocked your microphone. Allow it in System Settings → Privacy & Security → Microphone.");
        return;
      }
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const sample = () => {
        if (recorder.current?.state === "inactive") return;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        allLevels.current.push(Math.min(1, peak * 1.6));
        setLevels(allLevels.current.slice(-48));
        const s = (Date.now() - started.current) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) { finish.current = "review"; recorder.current?.stop(); return; }
        raf = window.setTimeout(sample, 100) as unknown as number;
      };
      const rec = new MediaRecorder(stream, { mimeType: type });
      recorder.current = rec;
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => void stopped(type);
      rec.start(250);
      started.current = Date.now();
      setState("recording");
      sample();
    })();
    return () => {
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      if (recorder.current?.state === "recording") { finish.current = "cancel"; recorder.current.stop(); }
    };
  }, []);

  async function stopped(type: string) {
    // The microphone goes off as soon as recording ends, review or not.
    mic.current?.getTracks().forEach((t) => t.stop());
    if (finish.current === "cancel") return;
    const blob = new Blob(chunks.current, { type });
    const duration = Math.max(1, Math.round((Date.now() - started.current) / 1000));
    // 64 levels across the whole take, as the server stores them.
    const all = allLevels.current;
    const waveform = Array.from({ length: 64 }, (_, i) => {
      const slice = all.slice(Math.floor((i * all.length) / 64), Math.floor(((i + 1) * all.length) / 64));
      return slice.length ? Math.round(Math.max(...slice) * 100) / 100 : 0;
    });
    const recorded: Take = { blob, url: URL.createObjectURL(blob), type, duration, waveform };
    if (finish.current === "review") { setTake(recorded); setState("review"); return; }
    await send(recorded);
  }

  async function send({ blob, type, duration, waveform }: Take) {
    setState("sending");
    const plain = type.split(";")[0];
    const result = await ch.files.uploadForm({
      path, field: "file", name: plain === "audio/aac" ? "voice.aac" : "voice.m4a", type: plain, bytes: await blob.arrayBuffer(),
      fields: {
        mimeType: plain, durationSeconds: String(duration), waveform: JSON.stringify(waveform), clientMutationId: crypto.randomUUID(),
        ...(body.trim() ? { body } : {}), ...(parentMessageId ? { parentMessageId } : {}),
      },
    });
    // Over a limit: the website's sentence ("You're sending too fast…"), not ours.
    if (!result.ok) { setState("error"); setError(rateLimitMessage(result) ?? "Couldn't send the voice memo."); return; }
    onSent((result.data as { message?: unknown } | undefined)?.message);
  }

  if (state === "error") {
    return <div className="voice-rec error"><span>{error}</span><button className="btn" onClick={onCancel}>OK</button></div>;
  }
  if (take) {
    return (
      <div className="voice-rec review">
        <button className="iconbtn" title="Delete" disabled={state === "sending"} onClick={onCancel}><Trash2 /></button>
        <VoicePlayer memo={{ durationSeconds: take.duration, waveform: take.waveform, mimeType: take.type, url: take.url }} />
        <span className="grow" />
        {state === "sending" ? <Loader2 className="spin" /> : <button className="send on" title="Send" onClick={() => void send(take)}><SendHorizontal /></button>}
      </div>
    );
  }
  return (
    <div className="voice-rec">
      <button className="iconbtn" title="Discard" onClick={() => { finish.current = "cancel"; recorder.current?.stop(); onCancel(); }}><Trash2 /></button>
      <span className="rec-dot" />
      <span className="vtime">{clock(seconds)}</span>
      <span className="wave live">{levels.map((l, i) => <i key={i} style={{ height: `${Math.max(10, l * 100)}%` }} />)}</span>
      {state === "sending" ? <Loader2 className="spin" /> : (
        <>
          <button className="iconbtn" title="Stop and listen back" onClick={() => { finish.current = "review"; recorder.current?.stop(); }}><Square /></button>
          <button className="send on" title="Send" onClick={() => { finish.current = "send"; recorder.current?.stop(); }}><SendHorizontal /></button>
        </>
      )}
    </div>
  );
}
