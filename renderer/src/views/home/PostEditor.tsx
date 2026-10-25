import { useEffect, useMemo, useRef } from "react";
import { EditorContent, mergeAttributes, Node, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, Loader2, Quote, Strikethrough } from "lucide-react";
import { promptText } from "../hub/DealPanel";

/*
  Editing a post's stored HTML in place, with the website's post editor
  (components/RichEditor.tsx there): TipTap with headings 2–3, bold, italic,
  strike, inline code, lists, quotes and links, and no code blocks, rules or
  underline (the server's sanitizer drops <u>). So a post written on the
  website keeps its formatting when it's edited on the Mac, and a plain post
  written here comes back as the same paragraphs.
*/

/**
 * A mention as the website stores it:
 * <span class="mention" data-type="mention" data-id="…" data-label="…">@Name</span>.
 * New mentions aren't offered here; existing ones stay exactly as they were.
 */
const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute("data-id"), renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}) },
      label: { default: null, parseHTML: (el) => el.getAttribute("data-label"), renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}) },
      text: { default: "", parseHTML: (el) => el.textContent ?? "", renderHTML: () => ({}) },
    };
  },
  parseHTML: () => [{ tag: 'span[data-type="mention"]' }],
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "mention", "data-type": "mention" }, HTMLAttributes), node.attrs.text || `@${node.attrs.label ?? ""}`];
  },
  renderText: ({ node }) => node.attrs.text || `@${node.attrs.label ?? ""}`,
});

/**
 * onSave gets the new HTML, or null when nothing changed (so an unchanged
 * post isn't stamped "edited"), and whether the words are now empty.
 */
export function PostEditor({ html, saving, error, onSave, onCancel }: {
  html: string;
  saving: boolean;
  error: string | null;
  onSave: (html: string | null, empty: boolean) => void;
  onCancel: () => void;
}) {
  // What the editor makes of the post before any change, to tell an edit from none.
  const before = useRef<string | null>(null);
  const save = () => {
    const current = editor?.getHTML() ?? null;
    if (!editor || current === null) return;
    onSave(current === before.current ? null : current, !editor.getText().trim() && !editor.$nodes("mention")?.length);
  };
  // The latest handlers, for the keymap that's set up once.
  const keys = useRef({ save, onCancel });
  keys.current = { save, onCancel };
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, horizontalRule: false, underline: false, link: false }),
    // No default target or rel: a link keeps what it was saved with (the server sets rel itself).
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: null, rel: null, class: null } }),
    Mention,
  ], []);
  const editor = useEditor({
    extensions,
    content: html,
    shouldRerenderOnTransaction: true,
    onCreate: ({ editor: created }) => { before.current = created.getHTML(); },
    // Spaces typed in the Mac composer are part of the post: keep them.
    parseOptions: { preserveWhitespace: true },
    editorProps: {
      attributes: { class: "rich post-edit-body", "aria-label": "Edit post" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); keys.current.onCancel(); return true; }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); keys.current.save(); return true; }
        return false;
      },
    },
    autofocus: "end",
  });
  useEffect(() => { editor?.setEditable(!saving); }, [editor, saving]);
  if (!editor) return null;
  const btn = (title: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button title={title} className={active ? "on" : ""} disabled={saving} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  );
  return (
    <div className="post-editor">
      <div className="pe-toolbar">
        {btn("Heading", <Heading2 />, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
        <i />
        {btn("Bold (⌘B)", <Bold />, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {btn("Italic (⌘I)", <Italic />, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {btn("Strikethrough", <Strikethrough />, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
        {btn("Code", <Code />, () => editor.chain().focus().toggleCode().run(), editor.isActive("code"))}
        {btn("Link", <Link2 />, () => void promptText("Link", editor.getAttributes("link").href ?? "https://").then((url) => {
          if (url === null) return;
          if (!url.trim() || url === "https://") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:\/\/|mailto:)/.test(url) ? url : `https://${url}` }).run();
        }), editor.isActive("link"))}
        <i />
        {btn("Bulleted list", <List />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {btn("Numbered list", <ListOrdered />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {btn("Quote", <Quote />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
      </div>
      <EditorContent editor={editor} />
      {error ? <div className="signin-error">{error}</div> : null}
      <div className="hint">Escape to cancel · ⌘↩ to save
        <button className="btn" disabled={saving} onClick={onCancel}>Cancel</button>
        <button className="btn honey" disabled={saving} onClick={save}>{saving ? <Loader2 className="spin" /> : null}{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
