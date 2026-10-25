import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, CheckCircle2, Circle, Lock, PictureInPicture2, Play, PlayCircle, Plus, Trash2, VideoOff } from "lucide-react";
import { ch } from "../../lib/bridge";
import {
  embedFor, serverNotes, lastLesson, lastLessonIn, loadNotes, percent, rememberLesson, saveNotes, setComplete, stamp, useCourse, useCourses, useLesson,
  type Course, type LessonNote,
} from "../../lib/learn";
import { RichText } from "../../lib/html";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Modal } from "../hub/parts";
import { nav } from "../../lib/nav";

const GRADIENTS = [
  "linear-gradient(120deg, #1F1E1C 55%, #FFCC04 55%)",
  "linear-gradient(120deg, #8A3A12, #F07A1C)",
  "linear-gradient(120deg, #284B9C, #5BA0F2)",
  "linear-gradient(120deg, #1D6B3A, #46D07A)",
  "linear-gradient(120deg, #5B2BAA, #B47AF2)",
  "linear-gradient(120deg, #161B2B, #3F4A5E)",
];

function Cover({ title, url, index, children }: { title: string; url: string | null; index: number; children?: React.ReactNode }) {
  return (
    <div className="cover-art" style={url ? undefined : { background: GRADIENTS[index % GRADIENTS.length] }}>
      {url ? <img src={url} alt={title} /> : null}
      {children}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ACADEMY_INCLUDES = ["All courses, not just New Bee", "Group coaching calls and events", "Every channel and the full feed", "DM any creator in the hive"];

/** A locked course: what the UGC Academy adds, as the website's upgrade dialog says it. */
function UpgradeDialog({ onClose }: { onClose: () => void }) {
  const access = useQuery({ queryKey: ["me", "access"], staleTime: 300_000, queryFn: () => api<{ access: { upgradeUrl: string | null } }>("/api/me/access") });
  const url = access.data?.access.upgradeUrl ?? "https://cal.com/team/creatorhive/skool";
  return (
    <Modal width={400} onClose={onClose}>
      <div className="upgrade">
        <span className="upgrade-mark"><Lock /></span>
        <h2>Part of the UGC Academy</h2>
        <p className="muted">Every course, live group coaching calls, all the channels, and DMs with the whole community.</p>
        <ul>{ACADEMY_INCLUDES.map((item) => <li key={item}><Check />{item}</li>)}</ul>
        <button className="btn honey lg" onClick={() => { ch.app.openExternal(url); onClose(); }}>Upgrade</button>
        <button className="btn ghost" onClick={onClose}>Not now</button>
      </div>
    </Modal>
  );
}

export function Courses() {
  const [upgrade, setUpgrade] = useState(false);
  const { data, isLoading, isError } = useCourses();
  const [filter, setFilter] = useState<"all" | "progress" | "done">("all");
  const last = lastLesson();
  const continuing = last ? data?.find((c) => c.id === last.courseId) : undefined;
  const list = (data ?? []).filter((c) => filter === "all" || (filter === "done" ? c.lessonCount > 0 && c.completedCount === c.lessonCount : c.completedCount > 0 && c.completedCount < c.lessonCount));
  return (
    <div className="page">
      {upgrade ? <UpgradeDialog onClose={() => setUpgrade(false)} /> : null}
      <div className="mhead">
        <h1>Courses</h1>
        <div className="acts"><div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "progress" ? "on" : ""} onClick={() => setFilter("progress")}>In progress</button>
          <button className={filter === "done" ? "on" : ""} onClick={() => setFilter("done")}>Completed</button>
        </div></div>
      </div>
      <div className="scroll page-body courses-body">
        {isLoading ? <div className="empty-state">Loading courses…</div> : null}
        {isError ? <div className="empty-state">Couldn't load courses.</div> : null}
        {continuing && last && filter === "all" ? (
          <div className="card continue">
            <button className="continue-art" onClick={() => nav.open({ kind: "course", id: continuing.id, lessonId: last.lessonId }, "learn", "ch")}><Play /></button>
            <div className="continue-text">
              <span className="section-label">Continue where you left off</span>
              <h2>{continuing.title}</h2>
              <span className="muted">{continuing.completedCount} of {continuing.lessonCount} lessons done</span>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn honey" onClick={() => nav.open({ kind: "course", id: continuing.id, lessonId: last.lessonId }, "learn", "ch")}><Play />Resume</button>
              </div>
            </div>
            <div className="continue-pct"><span className="bar"><i style={{ width: `${percent(continuing)}%` }} /></span>{percent(continuing)}%</div>
          </div>
        ) : null}
        <div className="course-grid">
          {list.map((c, i) => (
            <button key={c.id} className={`card course-card ${c.locked ? "locked" : ""}`}
              onClick={() => (c.locked ? setUpgrade(true) : nav.open({ kind: "course", id: c.id }, "learn", "ch"))}>
              <Cover title={c.title} url={c.coverUrl} index={i}>{c.locked ? <span className="lock"><Lock /></span> : null}</Cover>
              <div className="cc-text">
                <b>{c.title}</b>
                {c.description ? <span className="muted">{c.description}</span> : null}
              </div>
              <div className="cc-foot">
                <span className="muted">{c.lessonCount ? `${plural(c.moduleCount, "module")} · ${plural(c.lessonCount, "lesson")}` : "Coming soon"}</span>
                <span className="muted">{percent(c)}%</span>
              </div>
              <span className="bar"><i style={{ width: `${percent(c)}%` }} /></span>
            </button>
          ))}
        </div>
        {data && list.length === 0 ? <div className="empty-state">Nothing here yet.</div> : null}
      </div>
    </div>
  );
}

/* ---------- The lesson player ---------- */

/** YouTube's iframe API, spoken through postMessage: the time, play/pause and seeking. */
function useYouTube(frame: React.RefObject<HTMLIFrameElement | null>, enabled: boolean) {
  const time = useRef(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onMessage = (event: MessageEvent) => {
      if (!/youtube\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.info?.currentTime !== undefined) time.current = data.info.currentTime;
        if (data?.info?.playerState !== undefined) setPlaying(data.info.playerState === 1);
      } catch { /* not ours */ }
    };
    window.addEventListener("message", onMessage);
    const listen = setInterval(() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1 }), "*"), 1000);
    return () => { window.removeEventListener("message", onMessage); clearInterval(listen); };
  }, [enabled, frame]);
  const command = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  return {
    time,
    playing,
    toggle: () => command(playing ? "pauseVideo" : "playVideo"),
    pause: () => command("pauseVideo"),
    seek: (seconds: number) => { command("seekTo", [Math.max(0, seconds), true]); command("playVideo"); },
    skip: (delta: number) => command("seekTo", [Math.max(0, time.current + delta), true]),
  };
}

function Notes({ lessonId, timed, now, seek }: { lessonId: string; timed: boolean; now: () => number; seek: (s: number) => void }) {
  const [notes, setNotes] = useState<LessonNote[]>(() => loadNotes(lessonId));
  const [onServer, setOnServer] = useState(false);
  useEffect(() => {
    let live = true;
    void serverNotes(lessonId).then((list) => { if (live && list) { setNotes(list); setOnServer(true); } });
    return () => { live = false; };
  }, [lessonId]);
  const [draft, setDraft] = useState("");
  const [at, setAt] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Notes still being saved: their real id, once the server answers (a delete waits for it).
  const saving = useRef(new Map<string, Promise<string | null>>());
  useEffect(() => { setNotes(loadNotes(lessonId)); setDraft(""); }, [lessonId]);
  useEffect(() => {
    const start = () => { setAt(timed ? now() : null); input.current?.focus(); };
    window.addEventListener("ch:lesson-note", start);
    return () => window.removeEventListener("ch:lesson-note", start);
  }, [timed, now]);
  const update = (next: LessonNote[]) => { setNotes(next); if (!onServer) saveNotes(lessonId, next); };
  function add() {
    if (!draft.trim()) return;
    const note: LessonNote = { id: crypto.randomUUID(), at: timed ? Math.floor(at ?? now()) : null, text: draft.trim(), createdAt: new Date().toISOString() };
    update([...notes, note].sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9)));
    if (onServer) {
      const saved = api<{ note: { id: string } }>(`/api/lessons/${lessonId}/notes`, { method: "POST", body: { body: note.text, atSeconds: note.at } })
        .then(({ note: s }) => { setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, id: s.id } : n))); return s.id; })
        .catch(() => { window.alert("That note wasn't saved."); return null; })
        .finally(() => saving.current.delete(note.id));
      saving.current.set(note.id, saved);
    }
    setDraft("");
    setAt(null);
  }
  async function remove(note: LessonNote) {
    update(notes.filter((x) => x.id !== note.id));
    if (!onServer) return;
    // A note deleted while it's still saving has no server id yet: wait for it, then delete that.
    const id = saving.current.has(note.id) ? await saving.current.get(note.id) : note.id;
    if (!id) return;
    setNotes((list) => list.filter((x) => x.id !== id));
    try {
      await api(`/api/lessons/${lessonId}/notes?noteId=${id}`, { method: "DELETE" });
    } catch {
      setNotes((list) => [...list, { ...note, id }].sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9)));
      window.alert("That note wasn't deleted.");
    }
  }
  return (
    <div className="card lesson-notes">
      <div className="ln-head"><b>Your notes</b><span className="faint">{onServer ? "Saved to this lesson" : "Saved on this Mac"} · ⇧⌘N adds a note{timed ? " at the current time" : ""}</span></div>
      {notes.map((n) => (
        <div key={n.id} className="ln-row">
          {n.at !== null ? <button className="ln-time" onClick={() => seek(n.at!)} title="Jump to this moment">{stamp(n.at)}</button> : <span className="ln-time none">•</span>}
          <span className="selectable">{n.text}</span>
          <button className="iconbtn sm" aria-label="Delete note" onClick={() => void remove(n)}><Trash2 /></button>
        </div>
      ))}
      <div className="ln-add">
        {timed ? <span className="ln-time pending">{stamp(at ?? now())}</span> : null}
        <input ref={input} className="field" placeholder="Add a note…" value={draft} onFocus={() => setAt((a) => a ?? (timed ? now() : null))}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
        <button className="btn" disabled={!draft.trim()} onClick={add}><Plus />Add</button>
      </div>
    </div>
  );
}

function flatLessons(course: Course | undefined) {
  return course ? course.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title }))) : [];
}

export function CoursePage({ id, lessonId: requested }: { id: string; lessonId?: string }) {
  const course = useCourse(id);
  const lessons = useMemo(() => flatLessons(course.data), [course.data]);
  const lessonId = requested ?? lastLessonIn(id) ?? lessons.find((l) => !l.completed)?.id ?? lessons[0]?.id ?? null;
  const lesson = useLesson(lessonId);
  const index = lessons.findIndex((l) => l.id === lessonId);
  const prev = index > 0 ? lessons[index - 1] : null;
  const next = index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : null;
  const embed = embedFor(lesson.data?.videoUrl ?? null);
  const frame = useRef<HTMLIFrameElement>(null);
  const yt = useYouTube(frame, embed?.provider === "youtube");
  const done = lessons.filter((l) => l.completed).length;
  const go = (lid: string) => nav.open({ kind: "course", id, lessonId: lid }, "learn", "ch");
  const [reloads, setReloads] = useState(0);
  // The floating window picks up where this player is, and this one stops so the two don't play at once.
  const popOut = () => {
    const start = embed?.provider === "youtube" ? Math.floor(yt.time.current) : 0;
    if (embed?.provider === "youtube") yt.pause();
    else setReloads((n) => n + 1);
    ch.window.popout({ kind: "lesson", id: `${id}:${lessonId}:${start}`, title: lesson.data?.title });
  };

  useEffect(() => { if (lessonId) rememberLesson(id, lessonId); }, [id, lessonId]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && lesson.data) { e.preventDefault(); void setComplete(lesson.data, id, !lesson.data.completed); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && embed?.provider === "youtube") { e.preventDefault(); yt.toggle(); }
      if (e.key.toLowerCase() === "j" && embed?.provider === "youtube") yt.skip(-10);
      if (e.key.toLowerCase() === "l" && embed?.provider === "youtube") yt.skip(10);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [lesson.data, embed?.provider, id, yt]);

  if (course.isError) return <div className="page"><div className="empty-state">This course isn't available.</div></div>;
  // A course announced before its lessons are up: say so, instead of an empty player.
  if (course.data && lessons.length === 0) {
    return (
      <div className="page">
        <div className="mhead">
          <button className="iconbtn" onClick={() => nav.open({ kind: "learn", page: "courses" }, "learn", "ch")} aria-label="All courses"><ChevronLeft /></button>
          <h1>{course.data.title}</h1>
        </div>
        <div className="empty-state"><div><b>Coming soon</b><p className="muted">This course's lessons aren't up yet. Check back soon.</p></div></div>
      </div>
    );
  }

  return (
    <div className="page lesson-page">
      <div className="mhead">
        <button className="iconbtn" onClick={() => nav.open({ kind: "learn", page: "courses" }, "learn", "ch")} aria-label="All courses"><ChevronLeft /></button>
        <h1>{lesson.data?.title ?? course.data?.title ?? ""}</h1>
        <span className="sub">{course.data?.title}{index >= 0 ? ` · ${lessons[index].moduleTitle}` : ""}</span>
        <div className="acts">
          <button className="btn" disabled={!prev} onClick={() => prev && go(prev.id)} title="Previous lesson"><ArrowLeft /><span className="btn-label">Previous</span></button>
          {lesson.data ? (
            <button className={`btn ${lesson.data.completed ? "" : "honey"}`} onClick={() => void setComplete(lesson.data!, id, !lesson.data!.completed)}>
              <Check />{lesson.data.completed ? "Completed" : "Mark complete"}<span className="kbd-in">⌘↩</span>
            </button>
          ) : null}
          <button className="btn" disabled={!next} onClick={() => next && go(next.id)}>Next lesson<ArrowRight /></button>
        </div>
      </div>
      <div className="lesson-body">
        <div className="lesson-main scroll">
          {lesson.data?.videoUrl ? (
            embed ? (
              <div className="player">
                <iframe ref={frame} key={`${embed.src}#${reloads}`} src={embed.src} title={lesson.data.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
              </div>
            ) : <div className="player empty"><VideoOff />This lesson's video link isn't one we can play. <button className="link" onClick={() => ch.app.openExternal(lesson.data!.videoUrl!)}>Open it in the browser</button></div>
          ) : lesson.data ? <div className="player empty"><PlayCircle />No video yet</div> : <div className="player empty" />}
          {embed ? (
            <div className="player-bar faint">
              {embed.provider === "youtube" ? <span>Space play · J / L skip 10s · ⌘↩ mark complete</span> : <span>⌘↩ mark complete</span>}
              <button className="link" onClick={popOut}><PictureInPicture2 />Watch in a floating window</button>
            </div>
          ) : null}
          {lessonId ? <Notes lessonId={lessonId} timed={embed?.provider === "youtube"} now={() => yt.time.current} seek={yt.seek} /> : null}
          {lesson.data?.body ? <div className="lesson-text"><RichText html={lesson.data.body} /></div> : null}
        </div>
        <aside className="lesson-list scroll">
          <div className="ll-head"><b>Lessons</b><span className="faint">{done} of {lessons.length} done</span></div>
          <span className="bar"><i style={{ width: `${lessons.length ? (done / lessons.length) * 100 : 0}%` }} /></span>
          {course.data?.modules.map((m, mi) => (
            <div key={m.id}>
              <div className="section-label ll-mod">Module {mi + 1} · {m.title}</div>
              {m.lessons.map((l) => (
                <button key={l.id} className={`ll-row ${l.id === lessonId ? "on" : ""}`} onClick={() => go(l.id)}>
                  {l.completed ? <CheckCircle2 className="done" /> : l.id === lessonId ? <PlayCircle /> : <Circle />}
                  <span>{l.title}</span>
                  {l.durationSeconds ? <span className="faint">{Math.round(l.durationSeconds / 60)}m</span> : null}
                </button>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

/** The floating lesson window: just the video, kept above other windows. */
export function LessonVideo({ courseId, lessonId, start = 0 }: { courseId: string; lessonId: string; start?: number }) {
  const lesson = useLesson(lessonId);
  const embed = embedFor(lesson.data?.videoUrl ?? null);
  void courseId;
  // A YouTube lesson carries on from where the main window's player was.
  const src = embed?.provider === "youtube" ? `${embed.src}&start=${start}&autoplay=1` : embed?.src;
  return (
    <div className="floating-video">
      <div className="popout-drag" />
      {embed ? <iframe src={src} title={lesson.data?.title ?? "Lesson"} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : <div className="empty-state">Loading…</div>}
    </div>
  );
}
