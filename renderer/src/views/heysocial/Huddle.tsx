import { useEffect, useRef, useState } from "react";
import { Headphones, Maximize2, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { Room, RoomEvent, Track, type Participant, type RemoteTrack, type TrackPublication } from "livekit-client";
import { ch, type SessionUser } from "../../lib/bridge";
import { api, queryClient, useChannels, useConversations } from "../../lib/api";
import { useHuddles, type Huddle } from "../../lib/heysocial";
import { Avatar, channelName } from "../../lib/ui";

/*
  Huddles (Hey Social Inc., team only): a LiveKit room per channel or DM, as on
  the website. On the Mac the huddle lives in its own small window that stays
  on top while you work; the sidebar shows a bar while you're in one.
*/

/* The website's synthesised sounds (lib/hey-social/huddle-sounds.ts). */
const NOTES = { start: [659.25, 880, 1318.5], join: [880, 1174.66], leave: [1174.66, 880], selfLeave: [880, 659.25, 440] };
export function playHuddleSound(kind: keyof typeof NOTES) {
  try {
    const ctx = new AudioContext();
    const gap = kind === "start" ? 0.09 : 0.11;
    NOTES[kind].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * gap;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch { /* no audio device */ }
}

/** Start or join the huddle in a channel or DM: opens the huddle window. */
export function openHuddle(kind: "channel" | "dm", id: string, label: string) {
  ch.window.popout({ kind: "huddle", id: `${kind}:${id}`, title: `Huddle · ${label}` });
}

const elapsed = (since: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

function useLabel(kind: "channel" | "dm", id: string) {
  const channels = useChannels("heysocial").data;
  const dms = useConversations("heysocial").data;
  return kind === "channel" ? `#${channelName(channels?.find((c) => c.id === id)?.name ?? "")}` : dms?.find((d) => d.id === id)?.displayName ?? "Huddle";
}

/** The bar at the bottom of the sidebar while you're in a huddle. */
export function HuddleBar({ me }: { me?: SessionUser }) {
  const huddles = useHuddles().data?.huddles ?? [];
  const [myId, setMyId] = useState<string | null>(me?.id ?? null);
  useEffect(() => { if (!myId) void ch.auth.session().then(({ user }) => setMyId(user?.id ?? null)); }, [myId]);
  const mine = huddles.find((h) => h.participants.some((p) => p.id === myId));
  useTick();
  const label = useLabel(mine?.target.kind ?? "channel", mine?.target.id ?? "");
  if (!mine) return null;
  return (
    <div className="huddle-bar">
      <div className="hb-top">
        <Headphones /><b>In huddle · {label}</b><span className="faint">{elapsed(mine.startedAt)}</span>
        <button className="iconbtn" title="Show the huddle" onClick={() => openHuddle(mine.target.kind, mine.target.id, label)}><Maximize2 /></button>
      </div>
      <div className="hb-people">
        {mine.participants.slice(0, 8).map((p) => <Avatar key={p.id} name={p.name} src={p.avatarUrl} seed={p.id} size={26} radius="7px" />)}
        {mine.participants.length > 8 ? <span className="faint">+{mine.participants.length - 8}</span> : null}
        <button className="hb-leave" title="Leave" onClick={() => ch.app.relay({ topic: "huddle", action: "leave" })}><PhoneOff /></button>
      </div>
    </div>
  );
}

/** The header button: start, join (with faces), or "In huddle". */
export function HuddleButton({ kind, id, label, huddle, meId }: { kind: "channel" | "dm"; id: string; label: string; huddle?: Huddle; meId: string }) {
  const inIt = huddle?.participants.some((p) => p.id === meId);
  if (!huddle) return <button className="iconbtn" title="Start huddle" onClick={() => openHuddle(kind, id, label)}><Headphones /></button>;
  return (
    <button className={`huddle-btn ${inIt ? "in" : ""}`} onClick={() => openHuddle(kind, id, label)}>
      <Headphones />{inIt ? "In huddle" : "Join"}
      {!inIt ? huddle.participants.slice(0, 3).map((p) => <Avatar key={p.id} name={p.name} src={p.avatarUrl} seed={p.id} size={20} radius="50%" />) : null}
    </button>
  );
}

/* ---------- The huddle window ---------- */

interface Tile { key: string; participant: Participant; track: TrackPublication | null; screen: boolean }

function VideoTile({ tile, room, stage = false }: { tile: Tile; room: Room; stage?: boolean }) {
  const el = useRef<HTMLVideoElement>(null);
  const track = tile.track?.track;
  useEffect(() => {
    if (!track || !el.current) return;
    track.attach(el.current);
    return () => { track.detach(el.current!); };
  }, [track]);
  const meta = (() => { try { return JSON.parse(tile.participant.metadata ?? "{}") as { avatarUrl?: string }; } catch { return {}; } })();
  const name = tile.participant.name || tile.participant.identity;
  const you = tile.participant === room.localParticipant;
  const muted = !tile.participant.isMicrophoneEnabled;
  return (
    <div className={`tile ${tile.participant.isSpeaking ? "speaking" : ""} ${stage ? "stage" : ""}`}>
      {track ? <video ref={el} autoPlay playsInline muted={you} /> : <Avatar name={name} src={meta.avatarUrl ?? null} seed={tile.participant.identity} size={stage ? 120 : 72} />}
      <span className="tile-name">{tile.screen ? `${name}'s screen` : you ? `${name} (you)` : name}{muted && !tile.screen ? <MicOff /> : null}</span>
    </div>
  );
}

export function HuddleWindow({ target, user }: { target: string; user: SessionUser }) {
  const [kind, id] = target.split(":") as ["channel" | "dm", string];
  const label = useLabel(kind, id);
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [state, setState] = useState<"connecting" | "live" | "ended" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);
  const huddles = useHuddles().data?.huddles;
  const huddle = huddles?.find((h) => h.target.kind === kind && h.target.id === id);
  const audio = useRef<HTMLDivElement>(null);
  useTick();

  useEffect(() => {
    let left = false;
    const refresh = () => bump((n) => n + 1);
    room.on(RoomEvent.ParticipantConnected, () => { playHuddleSound("join"); refresh(); });
    room.on(RoomEvent.ParticipantDisconnected, () => { playHuddleSound("leave"); refresh(); });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio && audio.current) audio.current.appendChild(track.attach());
      refresh();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach((e) => e.remove()); refresh(); });
    for (const e of [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished]) room.on(e, refresh);
    room.on(RoomEvent.Disconnected, () => { if (!left) setState("ended"); });

    (async () => {
      try {
        const data = await api<{ url: string; token: string }>("/api/hey-social/huddles", { method: "POST", body: { kind, id } });
        await room.connect(data.url, data.token);
        playHuddleSound(room.remoteParticipants.size === 0 ? "start" : "join");
        setState("live");
        void queryClient.invalidateQueries({ queryKey: ["hey-social", "huddles"] });
        try { await room.localParticipant.setMicrophoneEnabled(true); } catch { setError("The Mac blocked your microphone. Allow it in System Settings → Privacy & Security → Microphone."); }
        refresh();
      } catch (e) {
        setState("error");
        setError((e as { message?: string }).message?.includes("set up") ? "Huddles aren't set up yet." : "Couldn't join the huddle.");
        void api("/api/hey-social/huddles/leave", { method: "POST", body: { kind, id } }).catch(() => null);
      }
    })();

    const leaveOnClose = () => {
      left = true;
      void room.disconnect();
      void api("/api/hey-social/huddles/leave", { method: "POST", body: { kind, id } }).catch(() => null);
    };
    window.addEventListener("beforeunload", leaveOnClose);
    return () => { window.removeEventListener("beforeunload", leaveOnClose); leaveOnClose(); };
  }, [room, kind, id]);

  // The sidebar's Leave button and ⇧⌘Space (mute from anywhere) arrive here.
  useEffect(() => ch.app.onRelay((message) => {
    if (message.topic !== "huddle") return;
    if (message.action === "leave") void leave();
    if (message.action === "toggle-mic") void room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled).then(() => bump((n) => n + 1));
  }), [room]);

  async function leave() {
    playHuddleSound("selfLeave");
    await room.disconnect();
    await api("/api/hey-social/huddles/leave", { method: "POST", body: { kind, id } }).catch(() => null);
    void queryClient.invalidateQueries({ queryKey: ["hey-social", "huddles"] });
    window.close();
  }

  const toggle = async (what: "mic" | "camera" | "screen") => {
    const lp = room.localParticipant;
    try {
      if (what === "mic") await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      if (what === "camera") await lp.setCameraEnabled(!lp.isCameraEnabled);
      if (what === "screen") await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true });
      setError(null);
    } catch {
      if (what === "mic") setError("The Mac blocked your microphone. Allow it in System Settings → Privacy & Security → Microphone.");
      if (what === "camera") setError("The Mac blocked your camera. Allow it in System Settings → Privacy & Security → Camera.");
    }
    bump((n) => n + 1);
  };

  // Recomputed every render: LiveKit's participants are mutable objects, and the events above re-render.
  const tiles: Tile[] = [];
  for (const p of [room.localParticipant, ...room.remoteParticipants.values()]) {
    const screen = p.getTrackPublication(Track.Source.ScreenShare);
    if (screen?.track) tiles.push({ key: `${p.identity}:screen`, participant: p, track: screen, screen: true });
    const cam = p.getTrackPublication(Track.Source.Camera);
    tiles.push({ key: p.identity, participant: p, track: cam?.track && !cam.isMuted ? cam : null, screen: false });
  }
  const stage = tiles.find((t) => t.screen);
  const others = tiles.filter((t) => t !== stage);
  const lp = room.localParticipant;
  void user;

  return (
    <div className="huddle-window">
      <div className="hw-head"><Headphones /><b>Huddle · {label}</b><span>{huddle ? elapsed(huddle.startedAt) : ""}</span><span className="faint">{others.length} {others.length === 1 ? "person" : "people"}</span></div>
      <div className={`hw-body ${stage ? "with-stage" : ""}`}>
        {state === "connecting" ? <div className="hw-note">Joining…</div> : null}
        {state === "error" || state === "ended" ? <div className="hw-note">{state === "ended" ? "The huddle ended." : error}</div> : null}
        {stage ? <VideoTile tile={stage} room={room} stage /> : null}
        {state === "live" ? <div className="hw-grid" data-count={Math.min(others.length, 9)}>{others.map((t) => <VideoTile key={t.key} tile={t} room={room} />)}</div> : null}
      </div>
      {error && state === "live" ? <div className="hw-error">{error}</div> : null}
      <div className="hw-controls">
        <button className={lp.isMicrophoneEnabled ? "on" : ""} title="Mute (⇧⌘Space)" onClick={() => void toggle("mic")} disabled={state !== "live"}>{lp.isMicrophoneEnabled ? <Mic /> : <MicOff />}</button>
        <button className={lp.isCameraEnabled ? "on" : ""} title="Video" onClick={() => void toggle("camera")} disabled={state !== "live"}>{lp.isCameraEnabled ? <Video /> : <VideoOff />}</button>
        <button className={lp.isScreenShareEnabled ? "on" : ""} title="Share screen" onClick={() => void toggle("screen")} disabled={state !== "live"}><MonitorUp /></button>
        <button className="leave" onClick={() => void (state === "live" ? leave() : window.close())}><PhoneOff />Leave</button>
      </div>
      <div ref={audio} hidden />
    </div>
  );
}
