import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type JSONContent, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Bold, CheckSquare, ChevronRight, Code, File as FileIcon, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListOrdered, Loader2, Minus, Quote, Strikethrough } from "lucide-react";
import { ch } from "../../lib/bridge";
import { api, ApiError } from "../../lib/api";
import { bytes } from "../../lib/format";
import { promptText } from "../hub/DealPanel";

/*
  Writing a Resources page in the app. The same editor the website uses
  (TipTap 3, the same blocks and the same JSON), so a page written here opens
  unchanged on the website and iPhone, and the other way round. Saves itself
  0.7 s after you stop typing, with the page's version to avoid overwriting
  an edit made somewhere else.
*/

export interface ResFile { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number; url: string }

/*
  The page's version, shared by everything that saves it (the title and the
  body), and one save at a time: the server refuses a save made against an
  older version, so two saves racing would each think the other was a
  change made elsewhere.
*/
const versions = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();
export function savePage(pageId: string, fields: Record<string, unknown>) {
  const run = queue.then(async () => {
    const result = await api<{ version: number }>(`/api/resources/pages/${pageId}`, { method: "PATCH", body: { baseVersion: versions.get(pageId), ...fields } });
    versions.set(pageId, result.version);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
export const knowVersion = (pageId: string, version: number) => {
  if ((versions.get(pageId) ?? -1) < version) versions.set(pageId, version);
};

/* Files on the page, for the blocks to look up (the document stores ids, never URLs). */
let pageFiles: Record<string, ResFile> = {};

function ImageView({ node }: NodeViewProps) {
  const file = pageFiles[String(node.attrs.fileId)];
  return (
    <NodeViewWrapper className="doc-img" data-drag-handle>
      {file ? <img src={file.url} alt={String(node.attrs.alt ?? "")} onDoubleClick={() => void ch.files.quickLook(`/api/resources/files/${file.id}`, file.filename)} /> : <div className="faint">Picture</div>}
    </NodeViewWrapper>
  );
}
function FileView({ node }: NodeViewProps) {
  const file = pageFiles[String(node.attrs.fileId)];
  return (
    <NodeViewWrapper data-drag-handle>
      <button className="file-card" contentEditable={false} onClick={() => file && void ch.files.quickLook(`/api/resources/files/${file.id}`, file.filename)}>
        <span className={`ficon ${/pdf/.test(file?.mimeType ?? "") ? "pdf" : ""}`}>{/pdf/.test(file?.mimeType ?? "") ? "PDF" : <FileIcon />}</span>
        <span className="fmeta"><b>{file?.filename ?? "File"}</b><span>{file ? `${bytes(file.sizeBytes)} · Click for Quick Look` : ""}</span></span>
      </button>
    </NodeViewWrapper>
  );
}
function BookmarkView({ node }: NodeViewProps) {
  const url = String(node.attrs.url ?? "");
  return <NodeViewWrapper><button className="bookmark" contentEditable={false} onClick={() => ch.app.openExternal(url)}><Link2 /><span><b>{String(node.attrs.title || url)}</b><small className="faint">{url}</small></span></button></NodeViewWrapper>;
}
function PageLinkView({ node }: NodeViewProps) {
  return <NodeViewWrapper><span className="link" contentEditable={false}>📄 Linked page</span><span hidden>{String(node.attrs.pageId)}</span></NodeViewWrapper>;
}

const block = (name: string, attrs: Record<string, { default: unknown }>, tag: string, view: (p: NodeViewProps) => React.ReactNode) => Node.create({
  name, group: "block", atom: true, draggable: true,
  addAttributes: () => attrs,
  parseHTML: () => [{ tag: `div[${tag}]` }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { [tag]: "" })],
  addNodeView: () => ReactNodeViewRenderer(view),
});
const ResourceImage = block("resourceImage", { fileId: { default: null }, alt: { default: "" } }, "data-resource-image", ImageView);
const ResourceFileBlock = block("resourceFile", { fileId: { default: null } }, "data-resource-file", FileView);
const Bookmark = block("bookmark", { url: { default: null }, title: { default: "" } }, "data-bookmark", BookmarkView);
const PageLink = block("pageLink", { pageId: { default: null } }, "data-page-link", PageLinkView);

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;

export function PageEditor({ pageId, userId, initialDoc, version: initialVersion, files, onSaved, onConflict }: {
  pageId: string;
  userId: string;
  initialDoc: JSONContent;
  version: number;
  files: Record<string, ResFile>;
  onSaved: () => void;
  onConflict: () => void;
}) {
  pageFiles = files;
  knowVersion(pageId, initialVersion);
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const pickKind = useRef<"image" | "file">("file");

  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, link: false }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Placeholder.configure({ includeChildren: true, placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : node.type.name === "detailsSummary" ? "Toggle" : "Write something, or use the toolbar to add a block") }),
    TaskList, TaskItem.configure({ nested: true }),
    Details.configure({ persist: true }), DetailsSummary, DetailsContent,
    ResourceImage, ResourceFileBlock, Bookmark, PageLink,
  ], []);

  async function save(doc: JSONContent, text: string) {
    setState("saving");
    try {
      await savePage(pageId, { doc, docText: text.slice(0, 200_000) });
      setState("saved");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") { onConflict(); return; }
      setState("error");
    }
  }

  async function insertFiles(list: File[], at?: number) {
    for (const file of list) {
      const kind = IMAGE_TYPES.test(file.type) && pickKind.current !== "file" ? "image" : IMAGE_TYPES.test(file.type) ? "image" : "file";
      setUploading((n) => n + 1);
      const up = await ch.files.upload({ route: `/api/resources/pages/${pageId}/files/upload`, name: `resources/${userId}/${pageId}/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, "_")}`, type: file.type, bytes: await file.arrayBuffer(), access: "private", clientPayload: kind });
      if (up.ok) {
        try {
          const { file: saved } = await api<{ file: ResFile }>(`/api/resources/pages/${pageId}/files`, { method: "POST", body: { pathname: up.pathname, filename: file.name, kind } });
          pageFiles = { ...pageFiles, [saved.id]: saved };
          const content = kind === "image" ? { type: "resourceImage", attrs: { fileId: saved.id, alt: file.name } } : { type: "resourceFile", attrs: { fileId: saved.id } };
          const chain = editor?.chain().focus();
          if (at !== undefined) chain?.insertContentAt(at, content).run(); else chain?.insertContent(content).run();
        } catch (e) {
          window.alert((e as ApiError).code === "UNSUPPORTED_TYPE" ? `${file.name} isn't a type pages take.` : (e as ApiError).code === "TOO_LARGE" ? `${file.name} is too big.` : `${file.name} couldn't be added.`);
        }
      } else window.alert(`${file.name} couldn't be uploaded.`);
      setUploading((n) => n - 1);
    }
  }

  const editor = useEditor({
    extensions,
    content: initialDoc,
    editorProps: {
      attributes: { class: "rich doc-body editable", "aria-label": "Page content" },
      handlePaste: (_view, event) => {
        const pasted = [...(event.clipboardData?.files ?? [])];
        if (!pasted.length) return false;
        void insertFiles(pasted);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const dropped = [...(event.dataTransfer?.files ?? [])];
        if (moved || !dropped.length) return false;
        event.preventDefault();
        void insertFiles(dropped, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      setState("saving");
      if (timer.current) clearTimeout(timer.current);
      const doc = current.getJSON();
      const text = current.getText({ blockSeparator: "\n" });
      timer.current = window.setTimeout(() => void save(doc, text), 700);
    },
  }, [pageId]);

  // Leaving the page saves what's waiting.
  useEffect(() => () => {
    if (timer.current && editor) { clearTimeout(timer.current); void save(editor.getJSON(), editor.getText({ blockSeparator: "\n" })); }
  }, [editor]);

  if (!editor) return null;
  const btn = (title: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button title={title} className={active ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  );
  return (
    <div className="page-editor">
      <div className="pe-toolbar">
        {btn("Heading", <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        {btn("Sub-heading", <Heading3 />, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
        <i />
        {btn("Bold (⌘B)", <Bold />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {btn("Italic (⌘I)", <Italic />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {btn("Strikethrough", <Strikethrough />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        {btn("Code", <Code />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        {btn("Link", <Link2 />, () => void promptText("Link", editor.getAttributes("link").href ?? "https://").then((url) => {
          if (url === null) return;
          if (!url.trim() || url === "https://") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: /^https?:\/\//.test(url) ? url : `https://${url}` }).run();
        }), editor.isActive("link"))}
        <i />
        {btn("Bulleted list", <List />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {btn("Numbered list", <ListOrdered />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {btn("To-do list", <CheckSquare />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}
        {btn("Toggle", <ChevronRight />, () => editor.chain().focus().setDetails().run())}
        {btn("Quote", <Quote />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
        {btn("Divider", <Minus />, () => editor.chain().focus().setHorizontalRule().run())}
        <i />
        {btn("Picture", <ImageIcon />, () => { pickKind.current = "image"; if (picker.current) { picker.current.accept = "image/jpeg,image/png,image/webp,image/gif"; picker.current.click(); } })}
        {btn("File", <FileIcon />, () => { pickKind.current = "file"; if (picker.current) { picker.current.accept = ""; picker.current.click(); } })}
        <span className={`save-state ${state}`}>{uploading ? <><Loader2 className="spin" />Uploading…</> : state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Couldn't save" : ""}</span>
      </div>
      <EditorContent editor={editor} />
      <input ref={picker} type="file" multiple hidden onChange={(e) => { void insertFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}
