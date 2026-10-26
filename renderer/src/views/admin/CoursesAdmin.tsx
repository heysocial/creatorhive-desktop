import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { ArrowDown, ArrowUp, Bold, ChevronLeft, Heading2, Italic, Link2, List, ListOrdered, Loader2, Plus, Quote, Strikethrough } from "lucide-react";
import { api, ApiError } from "../../lib/api";
import { ch } from "../../lib/bridge";
import { nav } from "../../lib/nav";
import { Modal } from "../hub/parts";
import { promptText } from "../hub/DealPanel";
import "../../styles/admin-roadmap-courses.css";

/*
  Admin → Courses: the website's course editor (/admin/courses and
  /admin/courses/[id]; components/admin/CourseAdminList, CourseAdminDetail,
  LessonEditor). Create, order, publish and delete courses, modules and
  lessons; a course's title, description and cover; a lesson's video, length
  and body. Same routes, same payloads, same confirmations. Owner and team,
  as on the website (Admin.tsx shows it; every route checks isTeamRole).
*/

interface AdminCourse {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublished: boolean;
  lessonCount: number;
  draftLessonCount: number;
}

interface AdminLesson {
  id: string;
  title: string;
  body?: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  isPublished: boolean;
}

interface AdminModule {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  lessons: AdminLesson[];
}

interface AdminCourseDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublished: boolean;
  modules: AdminModule[];
}

/** What the server said went wrong: its sentence (a 409 names the completions at stake), or its code. */
function serverSaid(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const message = error.data?.message;
  return typeof message === "string" ? message : error.code;
}

/**
 * Up/down reordering, as the website's useReorder: the whole new order is
 * sent, the server stores each row's position from its index, then the list
 * is read again either way.
 */
async function reorder(endpoint: string, items: { id: string }[], id: string, direction: -1 | 1, onError: (message: string) => void) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return;
  const next = items.map((item) => item.id);
  [next[index], next[target]] = [next[target], next[index]];
  try {
    await api(endpoint, { method: "POST", body: { orderedIds: next } });
  } catch (error) {
    onError(error instanceof ApiError && error.code === "order_out_of_scope"
      ? "That order could not be saved — the list has changed. Reloading."
      : "Could not save the new order.");
  }
}

function Arrows({ label, first, last, busy, onMove }: { label: string; first: boolean; last: boolean; busy: boolean; onMove: (direction: -1 | 1) => void }) {
  return (
    <span className="ca-arrows">
      <button className="iconbtn" aria-label={`Move ${label} up`} title="Move up" disabled={first || busy} onClick={() => onMove(-1)}><ArrowUp /></button>
      <button className="iconbtn" aria-label={`Move ${label} down`} title="Move down" disabled={last || busy} onClick={() => onMove(1)}><ArrowDown /></button>
    </span>
  );
}

export function AdminCoursesAdmin({ id }: { id?: string }) {
  return id ? <CourseDetail courseId={id} /> : <CourseList />;
}

/* ---------- The list: /admin/courses ---------- */

function CourseList() {
  const query = useQuery({
    queryKey: ["admin", "courses"],
    queryFn: async () => (await api<{ courses: AdminCourse[] }>("/api/courses?scope=admin")).courses,
  });
  const courses = query.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => query.refetch();

  async function create() {
    const title = await promptText("Course title");
    if (!title?.trim()) return;
    setBusy(true);
    try {
      await api("/api/courses", { method: "POST", body: { title: title.trim() } });
      setError(null);
    } catch {
      setError("Could not create the course.");
    }
    setBusy(false);
    void load();
  }

  async function togglePublished(course: AdminCourse) {
    setBusy(true);
    await api(`/api/courses/${course.id}`, { method: "PATCH", body: { isPublished: !course.isPublished } }).catch(() => null);
    setBusy(false);
    void load();
  }

  async function remove(course: AdminCourse) {
    if (!window.confirm(`Delete "${course.title}"?\n\nThis cannot be undone.`)) return;
    try {
      await api(`/api/courses/${course.id}`, { method: "DELETE" });
    } catch (failure) {
      // 409 is the deletion guard: its message names the completions and offers unpublishing. Shown as written.
      const said = serverSaid(failure);
      setError(failure instanceof ApiError && failure.status === 409 && said ? said : "Could not delete the course.");
      return;
    }
    void load();
  }

  async function move(courseId: string, direction: -1 | 1) {
    setBusy(true);
    await reorder("/api/courses/reorder", courses ?? [], courseId, direction, setError);
    await load();
    setBusy(false);
  }

  return (
    <div className="page ca">
      <div className="mhead">
        <h1>Courses</h1><span className="sub">Create, order and publish. Students see published courses only.</span>
        <div className="acts"><button className="btn honey" onClick={() => void create()} disabled={busy}><Plus />New course</button></div>
      </div>
      <div className="ca-scroll">
        {query.isError && !courses ? <p className="ca-error" role="alert">Could not load courses. <button className="rm-link" onClick={() => void load()}>Try again</button></p> : null}
        {!courses && !query.isError ? <div className="empty-state"><Loader2 className="spin" /></div> : null}
        {error ? <p className="ca-error" role="alert">{error}</p> : null}
        {courses && courses.length === 0 ? <p className="ca-note">No courses yet.</p> : null}
        {courses?.length ? (
          <ol className="ca-list">
            {courses.map((course, index) => (
              <li key={course.id} className="ca-row">
                <Arrows label={course.title} first={index === 0} last={index === courses.length - 1} busy={busy} onMove={(direction) => void move(course.id, direction)} />
                {course.coverUrl ? <img className="ca-cover" src={coverSrc(course.coverUrl)} alt="" /> : <span className="ca-cover" />}
                <div className="ca-main">
                  <button className="ca-title" onClick={() => nav.open({ kind: "admin", page: "courses", id: course.id })}>{course.title}</button>
                  <span className="ca-meta">
                    {course.lessonCount} published lesson{course.lessonCount === 1 ? "" : "s"}
                    {course.draftLessonCount > 0 ? ` · ${course.draftLessonCount} draft` : ""}
                    {course.isPublished ? "" : " · course unpublished"}
                  </span>
                </div>
                <button className="btn" onClick={() => void togglePublished(course)} disabled={busy}>{course.isPublished ? "Unpublish" : "Publish"}</button>
                <button className="btn" onClick={() => void remove(course)} disabled={busy}>Delete</button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

/** Covers that predate upload are paths on the website (/covers/name.jpg), so they load from its origin. */
let origin = "";
void ch.info().then((info) => { origin = info.origin; }).catch(() => undefined);
function coverSrc(url: string) {
  return url.startsWith("/") ? `${origin}${url}` : url;
}

/* ---------- One course: /admin/courses/[id] ---------- */

const COVER_ERRORS: Record<string, string> = {
  unsupported_course_cover_type: "Choose a JPEG, PNG, or WebP image.",
  course_cover_file_too_large: "Cover images must be 5MB or smaller.",
  empty_course_cover_file: "That file is empty.",
  invalid_course_cover_image: "That image couldn't be read.",
  course_cover_upload_rate_limited: "Too many covers uploaded in the last hour. Try again later.",
};

function CourseDetail({ courseId }: { courseId: string }) {
  const query = useQuery({
    queryKey: ["admin", "course", courseId],
    queryFn: async () => (await api<{ course: AdminCourseDetail }>(`/api/courses/${courseId}`)).course,
  });
  const course = query.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The lesson being edited, with its body — which the course read omits. */
  const [editing, setEditing] = useState<AdminLesson | null>(null);
  const load = () => query.refetch();

  async function patch(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "PATCH", body: payload });
    } catch (failure) {
      setError(serverSaid(failure) ?? "That change could not be saved.");
    }
    setBusy(false);
    void load();
  }

  async function remove(url: string, kind: "module" | "lesson", label: string) {
    if (!window.confirm(`Delete "${label}"?\n\nThis cannot be undone.`)) return;
    try {
      await api(url, { method: "DELETE" });
    } catch (failure) {
      // The server's refusal names the completions at stake and offers unpublishing. Shown verbatim.
      const said = serverSaid(failure);
      setError(failure instanceof ApiError && failure.status === 409 && said ? said : `Could not delete this ${kind}.`);
      return;
    }
    void load();
  }

  /** Bodies live on the lesson read, not the course read, so fetch on open. */
  async function openLesson(lesson: AdminLesson) {
    const full = await api<{ lesson: AdminLesson }>(`/api/lessons/${lesson.id}`).then((r) => r.lesson).catch(() => lesson);
    setEditing(full);
  }

  async function uploadCover(file: File) {
    setBusy(true);
    setError(null);
    const result = await ch.files.uploadForm({ path: `/api/courses/${courseId}/cover`, field: "image", name: file.name, type: file.type, bytes: await file.arrayBuffer() });
    setBusy(false);
    if (!result.ok) {
      setError(COVER_ERRORS[result.error ?? ""] ?? result.error ?? "That cover could not be uploaded.");
      return;
    }
    void load();
  }

  /**
   * Publish or unpublish everything under a course or a module at once,
   * confirmed first with how much it touches, as the website does.
   */
  async function bulkPublish(url: string, isPublished: boolean, label: string) {
    const question = `${isPublished ? "Publish" : "Unpublish"} everything in ${label}?`;
    const detail = isPublished
      ? "Every module and lesson inside it becomes visible to students and starts counting toward grades."
      : "Every module and lesson inside it is hidden from students and stops counting toward grades. This can be undone.";
    if (!window.confirm(`${question}\n\n${detail}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "POST", body: { isPublished } });
    } catch (failure) {
      setError(serverSaid(failure) ?? "Could not change what is published.");
    }
    setBusy(false);
    void load();
  }

  async function addModule() {
    const title = await promptText("Module title");
    if (!title?.trim()) return;
    await api(`/api/courses/${courseId}/modules`, { method: "POST", body: { title: title.trim() } }).catch(() => setError("Could not add the module."));
    void load();
  }

  async function addLesson(moduleId: string) {
    const title = await promptText("Lesson title");
    if (!title?.trim()) return;
    await api(`/api/modules/${moduleId}/lessons`, { method: "POST", body: { title: title.trim() } }).catch(() => setError("Could not add the lesson."));
    void load();
  }

  async function moveModule(moduleId: string, direction: -1 | 1) {
    setBusy(true);
    await reorder(`/api/courses/${courseId}/modules/reorder`, course?.modules ?? [], moduleId, direction, setError);
    await load();
    setBusy(false);
  }

  async function moveLesson(module: AdminModule, lessonId: string, direction: -1 | 1) {
    setBusy(true);
    await reorder(`/api/modules/${module.id}/lessons/reorder`, module.lessons, lessonId, direction, setError);
    await load();
    setBusy(false);
  }

  const back = <button className="iconbtn" title="All courses" aria-label="All courses" onClick={() => nav.open({ kind: "admin", page: "courses" })}><ChevronLeft /></button>;

  if (!course) {
    return (
      <div className="page ca">
        <div className="mhead">{back}<h1>Edit course</h1></div>
        {query.isError ? <div className="empty-state"><p>Could not load this course.</p></div> : <div className="empty-state"><Loader2 className="spin" /></div>}
      </div>
    );
  }

  return (
    <div className="page ca">
      <div className="mhead">
        {back}<h1>Edit course</h1>
        <span className="sub">{course.isPublished ? "Published" : "Unpublished"}</span>
      </div>
      <div className="ca-scroll">
        <header className="ca-head" key={`${course.title}|${course.description}|${course.coverUrl}`}>
          <label className="flabel">Title</label>
          <input className="field ca-title-field" defaultValue={course.title} maxLength={200}
            onBlur={(event) => event.target.value !== course.title ? void patch(`/api/courses/${courseId}`, { title: event.target.value }) : undefined} />
          <label className="flabel">Description</label>
          <textarea className="field area" defaultValue={course.description ?? ""} rows={2}
            onBlur={(event) => event.target.value !== (course.description ?? "") ? void patch(`/api/courses/${courseId}`, { description: event.target.value }) : undefined} />
          <div className="ca-cover-row">
            <button className="btn" disabled={busy} onClick={() => void patch(`/api/courses/${courseId}`, { isPublished: !course.isPublished })}>
              {course.isPublished ? "Unpublish course" : "Publish course"}
            </button>
            {/*
              Two ways in, as on the website: Upload (a 1200x675 webp in Blob
              storage), or a pasted URL for the older covers kept as
              /covers/name.jpg. Emptying the URL removes the cover.
            */}
            <CoverUpload busy={busy} onFile={(file) => void uploadCover(file)} />
            <div className="ca-url">
              <label className="flabel">or paste a URL</label>
              <input className="field" defaultValue={course.coverUrl ?? ""} placeholder="/covers/name.jpg or https://…" disabled={busy}
                onBlur={(event) => event.target.value !== (course.coverUrl ?? "") ? void patch(`/api/courses/${courseId}`, { coverUrl: event.target.value }) : undefined} />
            </div>
            {course.coverUrl ? <img className="ca-cover-preview" src={coverSrc(course.coverUrl)} alt="" /> : null}
          </div>
        </header>

        {error ? <p className="ca-error" role="alert">{error}</p> : null}

        <div className="ca-actions">
          <button className="btn honey" onClick={() => void addModule()} disabled={busy}><Plus />Add module</button>
          <button className="btn" disabled={busy} onClick={() => void bulkPublish(`/api/courses/${courseId}/publish-content`, false, course.title)}>Unpublish all content</button>
          <button className="btn" disabled={busy} onClick={() => void bulkPublish(`/api/courses/${courseId}/publish-content`, true, course.title)}>Publish all content</button>
          {busy ? <Loader2 className="spin faint" style={{ width: 15, height: 15 }} /> : null}
        </div>

        {course.modules.map((module, moduleIndex) => {
          const allPublished = module.lessons.every((lesson) => lesson.isPublished);
          return (
            <section key={module.id} className="ca-module">
              <div className="ca-module-head">
                <Arrows label={module.title} first={moduleIndex === 0} last={moduleIndex === course.modules.length - 1} busy={busy} onMove={(direction) => void moveModule(module.id, direction)} />
                <strong className="ca-module-title">{module.title}{module.isPublished ? "" : <span className="ca-draft"> · draft</span>}</strong>
                <button className="btn" disabled={busy} onClick={() => void patch(`/api/modules/${module.id}`, { isPublished: !module.isPublished })}>
                  {module.isPublished ? "Unpublish" : "Publish"}
                </button>
                <button className="btn" disabled={busy} onClick={() => void addLesson(module.id)}><Plus />Lesson</button>
                <button className="btn" disabled={busy || module.lessons.length === 0}
                  onClick={() => void bulkPublish(`/api/modules/${module.id}/publish-content`, !allPublished, module.title)}>
                  {allPublished ? "Unpublish lessons" : "Publish lessons"}
                </button>
                <button className="btn" disabled={busy} onClick={() => void remove(`/api/modules/${module.id}`, "module", module.title)}>Delete</button>
              </div>
              {module.lessons.length === 0 ? <p className="ca-empty">No lessons yet.</p> : (
                <ol className="ca-lessons">
                  {module.lessons.map((lesson, index) => (
                    <li key={lesson.id} className="ca-lesson">
                      <Arrows label={lesson.title} first={index === 0} last={index === module.lessons.length - 1} busy={busy} onMove={(direction) => void moveLesson(module, lesson.id, direction)} />
                      <span className="ca-lesson-title">
                        {lesson.title}
                        <span className="ca-draft">{lesson.isPublished ? "" : " · draft"}{lesson.videoUrl ? "" : " · no video"}</span>
                      </span>
                      <button className="btn" disabled={busy} onClick={() => void openLesson(lesson)}>Edit</button>
                      <button className="btn" disabled={busy} onClick={() => void patch(`/api/lessons/${lesson.id}`, { isPublished: !lesson.isPublished })}>
                        {lesson.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button className="btn" disabled={busy} onClick={() => void remove(`/api/lessons/${lesson.id}`, "lesson", lesson.title)}>Delete</button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      {editing ? <LessonEditor lesson={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </div>
  );
}

function CoverUpload({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>Upload cover</button>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
    </>
  );
}

/* ---------- The lesson editor ---------- */

/*
  Which video a pasted link is, the way the website's lib/courses/video.ts
  reads it (YouTube in any share shape, a Loom share link, an old Cloudflare
  Stream link). Advisory only: the server validates the save with its own.
*/
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

function youTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    id = url.pathname.replace(/\/+$/, "") === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;
  }
  return id && /^[\w-]+$/.test(id) ? id : null;
}

function videoProvider(value: string): "youtube" | "loom" | "stream" | null {
  if (youTubeId(value)) return "youtube";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (["loom.com", "www.loom.com"].includes(url.hostname) && /^\/share\/[a-zA-Z0-9]+\/?$/.test(url.pathname)) return "loom";
  const host = url.hostname;
  const stream = host === "iframe.videodelivery.net" || host === "watch.videodelivery.net" || /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(host);
  if (stream && /^[0-9a-f]{32}$/.test(url.pathname.split("/").filter(Boolean)[0] ?? "")) return "stream";
  return null;
}

function VideoNote({ value }: { value: string }) {
  if (!value.trim()) return <p className="ca-video-note">No video.</p>;
  const provider = videoProvider(value);
  if (!provider) return <p className="ca-video-note bad">Not a link we recognise. Paste a Loom or YouTube link.</p>;
  if (provider === "stream") return <p className="ca-video-note bad">Cloudflare Stream has been cancelled — use a Loom or YouTube link.</p>;
  return <p className="ca-video-note">Recognised as {provider}.</p>;
}

function LessonEditor({ lesson, onSaved, onCancel }: { lesson: AdminLesson; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(lesson.title);
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? "");
  const [duration, setDuration] = useState(lesson.durationSeconds === null ? "" : String(lesson.durationSeconds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = useRef(lesson.body ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Every field is sent, the empty ones too: "" is how a video link or a length is cleared.
      await api(`/api/lessons/${lesson.id}`, {
        method: "PATCH",
        body: { title, body: body.current, videoUrl, durationSeconds: duration.trim() === "" ? null : Number(duration) },
      });
    } catch (failure) {
      setBusy(false);
      setError(serverSaid(failure) ?? "Could not save this lesson.");
      return;
    }
    setBusy(false);
    onSaved();
  }

  return (
    <Modal title="Edit lesson" onClose={() => { if (!busy) onCancel(); }} width={680}
      foot={<>
        {error ? <span className="form-error">{error}</span> : null}
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn honey" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save lesson"}</button>
      </>}>
      <div className="ca-lesson-form">
        <label className="flabel">Title</label>
        <input className="field" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        <label className="flabel">Video URL</label>
        <input className="field" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="Loom or YouTube link" />
        <VideoNote value={videoUrl} />
        <label className="flabel">Duration (seconds)</label>
        <input className="field" value={duration} inputMode="numeric" onChange={(event) => setDuration(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Leave empty for none" />
        <label className="flabel">Body</label>
        <LessonBody initial={lesson.body ?? ""} disabled={busy} onChange={(html) => { body.current = html; }} />
      </div>
    </Modal>
  );
}

/*
  The website's lesson body editor (components/RichEditor.tsx with mentions
  off): TipTap with headings 2–3, bold, italic, strike, lists, quotes and
  links, no code blocks or rules. The HTML it writes is what the website's
  editor writes, so a lesson edited here opens unchanged there.
*/
function LessonBody({ initial, disabled, onChange }: { initial: string; disabled: boolean; onChange: (html: string) => void }) {
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, link: false }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
    Placeholder.configure({ placeholder: "Write the lesson…" }),
  ], []);
  const editor = useEditor({
    extensions,
    content: initial,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    editorProps: { attributes: { "aria-label": "Lesson body" } },
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  if (!editor) return null;
  const btn = (title: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button title={title} aria-label={title} className={active ? "on" : ""} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  );
  return (
    <div className="ca-body-editor">
      <div className="pe-toolbar">
        {btn("Heading", <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {btn("Bold", <Bold />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {btn("Italic", <Italic />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {btn("Strikethrough", <Strikethrough />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        <i />
        {btn("Bullet list", <List />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {btn("Numbered list", <ListOrdered />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {btn("Quote", <Quote />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {btn("Link", <Link2 />, () => void promptText("Link URL", editor.getAttributes("link").href ?? "").then((url) => {
          if (url === null) return;
          if (url === "") { editor.chain().focus().unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange("link").setLink({ href: /^https?:\/\//i.test(url) ? url : `https://${url}` }).run();
        }), editor.isActive("link"))}
      </div>
      <div className="ca-body rich"><EditorContent editor={editor} /></div>
    </div>
  );
}
