import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, ChevronDown, ChevronRight, Heading2, Italic, Link2, List, ListOrdered, Plus, Quote, Star, Strikethrough, Trash2 } from "lucide-react";
import { api, queryClient } from "../../lib/api";
import { useAdminAccess } from "../../lib/admin";
import { nav } from "../../lib/nav";
import { promptText } from "../hub/DealPanel";
import "../../styles/admin-events-misc.css";

/*
  Two owner/team things on the website's Resources pages.

  The owner's switch for who sees the Resources workspace
  (components/resources/ResourcesHome.tsx, PATCH /api/resources/access):
  "Only you" or "Everyone", asked first.

  The shared CreatorHive guides (/api/pages), which owner and team write on
  the website's library (components/library/LibraryWorkspace.tsx): New page,
  a page inside a page, title, emoji, body (saved 0.8 s after typing stops),
  star, and Delete with its children. Members only read them.
*/

/* The "Who sees Resources" switch was removed in 2.0.16 (it was flipped by accident); the website hides Resources for everyone for now. */

/* ---------- The CreatorHive guides ---------- */

export interface GuideNode { id: string; parentId: string | null; title: string; icon: string | null; isPublished: boolean; starred: boolean }

/** Owner or team: the website's `canEdit` on the library. */
export function useCanEditGuides() {
  return useAdminAccess().data?.team === true;
}

const openGuide = (id: string) => nav.open({ kind: "resource", id }, "learn", "ch");

export async function newGuide(parentId: string | null = null) {
  try {
    const { page } = await api<{ page: GuideNode }>("/api/pages", { method: "POST", body: { parentId } });
    await queryClient.invalidateQueries({ queryKey: ["wiki", "pages"] });
    openGuide(page.id);
    return page.id;
  } catch {
    window.alert("Couldn't add a page.");
    return null;
  }
}

/** The guides as the website's library lists them for staff: starred first, then the tree, with + for a page inside. */
export function GuidesTree({ pages, current }: { pages: GuideNode[]; current?: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const starred = pages.filter((p) => p.starred);
  // Open the way to the page being shown.
  useEffect(() => {
    if (!current) return;
    const next: Record<string, boolean> = {};
    let at = pages.find((p) => p.id === current)?.parentId ?? null;
    while (at) { next[at] = true; at = pages.find((p) => p.id === at)?.parentId ?? null; }
    if (Object.keys(next).length) setOpen((was) => ({ ...was, ...next }));
  }, [current, pages.length]);

  const level = (parent: string | null, depth: number) => pages.filter((p) => p.parentId === parent).map((p) => {
    const hasKids = pages.some((x) => x.parentId === p.id);
    return (
      <Fragment key={p.id}>
        <div className={`tree-row gdx-tree-row ${current === p.id ? "on" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
          <button className="tw" onClick={() => setOpen({ ...open, [p.id]: !open[p.id] })} style={{ visibility: hasKids ? "visible" : "hidden" }} aria-label={open[p.id] ? "Collapse" : "Expand"}>{open[p.id] ? <ChevronDown /> : <ChevronRight />}</button>
          <button className="tl" onClick={() => openGuide(p.id)}><span>{p.icon ?? "📘"}</span>{p.title || "Untitled"}{p.isPublished === false ? <span className="gdx-draft">Draft</span> : null}</button>
          <button className="gdx-add" aria-label="Add child page" title="Add a page inside" onClick={async () => {
            if (await newGuide(p.id)) setOpen((was) => ({ ...was, [p.id]: true }));
          }}><Plus /></button>
        </div>
        {open[p.id] ? level(p.id, depth + 1) : null}
      </Fragment>
    );
  });

  return (
    <>
      <button className="btn gdx-new" onClick={() => void newGuide(null)}><Plus />New page</button>
      {starred.length ? (
        <>
          <div className="section-label" style={{ padding: "4px 10px" }}>Starred</div>
          {starred.map((p) => (
            <button key={p.id} className={`tree-row tl solo gdx-starred ${current === p.id ? "on" : ""}`} onClick={() => openGuide(p.id)}><Star className="gdx-star-ico" /><span>{p.icon}</span>{p.title || "Untitled"}</button>
          ))}
          <div className="section-label" style={{ padding: "10px 10px 4px" }}>Pages</div>
        </>
      ) : null}
      {level(null, 0)}
      {pages.length === 0 ? <p className="faint" style={{ padding: 10 }}>Click 'New page' to create your first page.</p> : null}
    </>
  );
}

interface GuideDetail {
  id: string; parentId: string | null; title: string; icon: string | null; body: string; isPublished: boolean;
  authorName: string | null; updatedAt: string; starred: boolean; breadcrumbs: { id: string; title: string; icon: string | null }[];
}

/** A guide, editable: the website's PageView with canEdit. */
export function GuideEditor({ id }: { id: string }) {
  // Always this moment's copy: the form starts from it, and a stale one would be saved back over a newer edit.
  const page = useQuery({ queryKey: ["wiki", "page", id, "edit"], gcTime: 0, staleTime: 0, queryFn: async () => (await api<{ page: GuideDetail }>(`/api/pages/${id}`)).page });
  if (page.isError) return <div className="empty-state">This page isn't available.</div>;
  if (!page.data || !page.isFetchedAfterMount) return <div className="empty-state">Loading…</div>;
  return <GuideForm key={page.data.id} page={page.data} />;
}

function GuideForm({ page }: { page: GuideDetail }) {
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon ?? "");
  const [body, setBody] = useState(page.body ?? "");
  const [starred, setStarred] = useState(page.starred);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const last = useRef({ title: page.title, body: page.body ?? "", icon: page.icon ?? "" });

  // Saves itself 0.8 s after the last change, as the website does.
  useEffect(() => {
    const current = { title, body, icon };
    const was = last.current;
    if (current.title === was.title && current.body === was.body && current.icon === was.icon) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      setFailed(false);
      try {
        // parentId goes back as it is: the route sets it from every save, and leaving it out would move the page to the top level.
        await api(`/api/pages/${page.id}`, { method: "PATCH", body: { title, body, icon: icon || null, parentId: page.parentId } });
        last.current = current;
        setSavedAt(new Date());
        void queryClient.invalidateQueries({ queryKey: ["wiki", "pages"] });
      } catch {
        setFailed(true);
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [title, body, icon, page.id, page.parentId]);

  async function toggleStar() {
    try {
      const result = await api<{ starred: boolean }>(`/api/pages/${page.id}/star`, { method: "POST" });
      setStarred(result.starred);
      void queryClient.invalidateQueries({ queryKey: ["wiki", "pages"] });
    } catch { /* stays as it was */ }
  }

  async function remove() {
    try {
      await api(`/api/pages/${page.id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["wiki", "page", page.id] });
      await queryClient.invalidateQueries({ queryKey: ["wiki", "pages"] });
      nav.open({ kind: "learn", page: "resources" }, "learn", "ch");
    } catch {
      window.alert("Couldn't delete the page.");
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="doc-page scroll">
      <div className="doc-inner">
        {page.breadcrumbs.length ? <div className="crumbs faint">{page.breadcrumbs.map((b) => <button key={b.id} onClick={() => openGuide(b.id)}>{b.icon} {b.title} /</button>)}</div> : null}
        <div className="gdx-head">
          <input className="gdx-icon" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} placeholder="🏷" maxLength={4} aria-label="Page emoji" />
          <div className="gdx-tools">
            {saving ? <span className="gdx-status">Saving…</span> : failed ? <span className="gdx-status">Not saved</span> : savedAt ? <span className="gdx-status">Saved</span> : null}
            <button className={`iconbtn gdx-star ${starred ? "on" : ""}`} onClick={() => void toggleStar()} aria-label={starred ? "Unstar" : "Star"}><Star /></button>
            {confirmingDelete ? (
              <>
                <span className="gdx-status">Delete page &amp; children?</span>
                <button className="btn evx-danger" onClick={() => void remove()}>Yes, delete</button>
                <button className="btn" onClick={() => setConfirmingDelete(false)}>Cancel</button>
              </>
            ) : <button className="iconbtn" onClick={() => setConfirmingDelete(true)} aria-label="Delete page"><Trash2 /></button>}
          </div>
        </div>
        <input className="gdx-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" aria-label="Title" />
        <div className="gdx-meta">{page.authorName ? `Created by ${page.authorName} · ` : ""}Updated {new Date(page.updatedAt).toLocaleDateString()}</div>
        <GuideBody value={page.body ?? ""} onChange={setBody} />
      </div>
    </div>
  );
}

/** The website's RichEditor for guides: headings, bold, italic, strike, lists, quote and links, kept as HTML. */
function GuideBody({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const [, redraw] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, link: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: value,
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
    onSelectionUpdate: () => redraw((n) => n + 1),
  });
  if (!editor) return null;
  return (
    <div className="gdx-editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const item = (label: string, active: boolean, run: () => void, Icon: typeof Bold) => (
    <button type="button" className={active ? "on" : ""} aria-label={label} title={label} aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} onClick={run}><Icon /></button>
  );
  async function toggleLink() {
    // On a link, the button takes it off; elsewhere it asks for the address.
    if (editor.isActive("link")) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    const url = await promptText("Link URL", "https://");
    if (!url || url === "https://") return;
    const normalized = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
  }
  return (
    <div className="gdx-bar" role="toolbar" aria-label="Formatting">
      {item("Heading", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2)}
      {item("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), Bold)}
      {item("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), Italic)}
      {item("Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), Strikethrough)}
      {item("Bullet list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), List)}
      {item("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
      {item("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), Quote)}
      {item("Link", editor.isActive("link"), () => void toggleLink(), Link2)}
    </div>
  );
}
