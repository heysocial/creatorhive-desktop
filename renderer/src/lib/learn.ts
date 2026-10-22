import { useQuery } from "@tanstack/react-query";
import { api, queryClient } from "./api";

/* Courses, Improve and Resources, as the website's routes send them. */

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  locked: boolean;
  moduleCount: number;
  lessonCount: number;
  completedCount: number;
}

export interface LessonSummary { id: string; title: string; videoUrl: string | null; durationSeconds: number | null; completed: boolean }
export interface Module { id: string; title: string; description: string | null; lessons: LessonSummary[] }
export interface Course { id: string; title: string; description: string | null; coverUrl: string | null; modules: Module[] }
export interface Lesson { id: string; title: string; body: string; videoUrl: string | null; durationSeconds: number | null; moduleId: string; courseId: string; completed: boolean }

export const useCourses = () => useQuery({ queryKey: ["courses"], queryFn: async () => (await api<{ courses: CourseSummary[] }>("/api/courses")).courses });
export const useCourse = (id: string) => useQuery({ queryKey: ["course", id], queryFn: async () => (await api<{ course: Course }>(`/api/courses/${id}`)).course });
export const useLesson = (id: string | null) => useQuery({ queryKey: ["lesson", id], enabled: Boolean(id), queryFn: async () => (await api<{ lesson: Lesson }>(`/api/lessons/${id}`)).lesson });

export const percent = (c: CourseSummary) => (c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0);

export async function setComplete(lesson: { id: string; courseId?: string }, courseId: string, completed: boolean) {
  const set = (value: boolean) => {
    queryClient.setQueryData<Course>(["course", courseId], (course) => course && ({
      ...course,
      modules: course.modules.map((m) => ({ ...m, lessons: m.lessons.map((l) => (l.id === lesson.id ? { ...l, completed: value } : l)) })),
    }));
    queryClient.setQueryData<Lesson>(["lesson", lesson.id], (l) => l && ({ ...l, completed: value }));
  };
  set(completed);
  try {
    await api(`/api/lessons/${lesson.id}/complete`, { method: completed ? "POST" : "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["courses"] });
    void queryClient.invalidateQueries({ queryKey: ["improve"] });
    if (completed) void queryClient.invalidateQueries({ queryKey: ["points"] });
  } catch {
    set(!completed);
  }
}

/* ---------- Video: YouTube and Loom (and old Cloudflare Stream links), as the website plays them ---------- */

export type Embed = { provider: "youtube" | "loom" | "stream"; id: string; src: string } | null;

export function embedFor(url: string | null): Embed {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return id ? { provider: "youtube", id, src: youtubeSrc(id) } : null;
  }
  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const id = u.searchParams.get("v") ?? /\/(embed|shorts|live|v)\/([\w-]{6,})/.exec(u.pathname)?.[2];
    return id ? { provider: "youtube", id, src: youtubeSrc(id) } : null;
  }
  if (host.endsWith("loom.com")) {
    const id = /\/(share|embed)\/([0-9a-f]{20,})/i.exec(u.pathname)?.[2];
    return id ? { provider: "loom", id, src: `https://www.loom.com/embed/${id}?hide_owner=true&hide_share=true&hide_title=true` } : null;
  }
  const stream = /([0-9a-f]{32})/i.exec(u.pathname)?.[1];
  if (stream && (host.endsWith("videodelivery.net") || host.endsWith("cloudflarestream.com"))) {
    return { provider: "stream", id: stream, src: `https://iframe.videodelivery.net/${stream}` };
  }
  return null;
}

/* enablejsapi lets the app read the time for timestamped notes and seek to them. */
const youtubeSrc = (id: string) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&enablejsapi=1`;

/* ---------- Timestamped lesson notes ----------
   Kept on this Mac until the server's notes table ships (it needs a database
   change, which Simon reviews first). Same shape the server will take. */

export interface LessonNote { id: string; at: number | null; text: string; createdAt: string }
const noteKey = (lessonId: string) => `ch.lesson-notes.${lessonId}`;
export function loadNotes(lessonId: string): LessonNote[] {
  try { return JSON.parse(localStorage.getItem(noteKey(lessonId)) ?? "[]"); } catch { return []; }
}
export function saveNotes(lessonId: string, notes: LessonNote[]) {
  try { localStorage.setItem(noteKey(lessonId), JSON.stringify(notes)); } catch { /* storage full or blocked */ }
}
export const stamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The lesson someone was last on, per course, for "Continue where you left off". */
export function rememberLesson(courseId: string, lessonId: string) {
  try {
    localStorage.setItem(`ch.course.last.${courseId}`, lessonId);
    localStorage.setItem("ch.course.last", JSON.stringify({ courseId, lessonId }));
  } catch { /* fine */ }
}
export function lastLesson(): { courseId: string; lessonId: string } | null {
  try { return JSON.parse(localStorage.getItem("ch.course.last") ?? "null"); } catch { return null; }
}
export function lastLessonIn(courseId: string) {
  try { return localStorage.getItem(`ch.course.last.${courseId}`); } catch { return null; }
}

/* ---------- Improve ---------- */

export interface MilestoneItem { id: string; label: string; mode: "manual" | "auto"; completed: boolean }
export interface Milestone { id: string; number: string; title: string; beeLabel: string | null; completed: boolean; current: boolean; locked: boolean; completedCount: number; totalCount: number; items: MilestoneItem[] }
export interface Improve {
  grade: { overallPercentage: number; coursePercentage: number; apPercentage: number; completedLessons: number; totalLessons: number; completedItems: number; totalItems: number };
  activationPoints: Milestone[];
  completedStages: number;
}
export const useImprove = () => useQuery({ queryKey: ["improve"], queryFn: async () => (await api<{ data: Improve }>("/api/improve")).data });

export interface ImproveResource { id: string; slug: string; title: string; description: string; type: string; icon: string; flagship?: boolean; mode: string; externalUrl?: string }
export const useImproveResources = () => useQuery({
  queryKey: ["improve", "resources"],
  staleTime: 60 * 60_000,
  retry: false,
  queryFn: async () => {
    try { return (await api<{ content: { resources: ImproveResource[] } }>("/api/improve/resources/content")).content.resources; } catch { return null; }
  },
});
