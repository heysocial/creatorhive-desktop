import { memo, type MouseEvent } from "react";
import { Marked } from "marked";
import { ch } from "./bridge";
import { openPath, ownSitePath } from "./links";

/*
  Message and post bodies arrive as HTML the server has already sanitized
  (lib/security/sanitize-rich-html.ts on the website). This pass is a second
  belt: only known tags and attributes survive, every link opens in the
  browser, and nothing can run.
*/

const TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "DEL", "STRIKE", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "A", "SPAN",
  "H1", "H2", "H3", "H4", "HR", "DIV", "MARK", "SUB", "SUP", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "INPUT",
]);
const ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  SPAN: new Set(["class", "data-mention", "data-user-id", "data-id", "data-type"]),
  OL: new Set(["start"]),
  INPUT: new Set(["type", "checked", "disabled"]),
};

/** Removed with everything inside them, words included. */
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "NOEMBED", "NOFRAMES", "TITLE", "FRAME", "FRAMESET",
]);
const HTML_NS = "http://www.w3.org/1999/xhtml";

export function clean(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  /*
    Walks each element's children as a live chain, not a snapshot. Unwrapping
    an unknown element moves its children up into its place, and the walk
    carries on from the first of them, so they're checked like any other —
    with a snapshot, `<x><img onerror=…></x>` came out with every attribute.
    SVG and MathML elements report lowercase names, hence the namespace check.
  */
  const walk = (node: Element) => {
    let child = node.firstElementChild;
    while (child) {
      const next = child.nextElementSibling;
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) {
        child.remove();
        child = next;
        continue;
      }
      if (!TAGS.has(tag) || child.namespaceURI !== HTML_NS || (tag === "INPUT" && child.getAttribute("type") !== "checkbox")) {
        // Keep the words of anything unknown, drop the element, then check what it held.
        const moved = [...child.childNodes];
        child.replaceWith(...moved);
        child = (moved.find((n) => n.nodeType === Node.ELEMENT_NODE) as Element | undefined) ?? next;
        continue;
      }
      const allowed = ATTRS[tag] ?? new Set<string>();
      for (const attr of [...child.attributes]) if (!allowed.has(attr.name)) child.removeAttribute(attr.name);
      if (tag === "A") {
        const href = child.getAttribute("href") ?? "";
        if (!/^(https?:|mailto:|\/)/i.test(href)) child.removeAttribute("href");
      }
      walk(child);
      child = next;
    }
  };
  walk(root);
  return root.innerHTML;
}

const cache = new Map<string, string>();
function cleaned(html: string) {
  let value = cache.get(html);
  if (value === undefined) {
    value = clean(html);
    if (cache.size > 2000) cache.clear();
    cache.set(html, value);
  }
  return value;
}

/** Links in a body: our own website's pages open in the app, anything else in the browser. */
export function onBodyClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link) return;
  event.preventDefault();
  void openLink(link.getAttribute("href") ?? "");
}

export async function openLink(href: string) {
  if (!href) return;
  const path = await ownSitePath(href);
  if (path) void openPath(path);
  else if (/^(https?|mailto):/i.test(href)) ch.app.openExternal(href);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain text with line breaks, as HTML. For bodies the server sends only as text. */
export const textToHtml = (text: string) => escape(text).replace(/\r?\n/g, "<br>");

export const RichText = memo(function RichText({ html, text, className = "rich" }: { html?: string | null; text?: string | null; className?: string }) {
  const source = html ?? (text ? textToHtml(text) : "");
  if (!source) return null;
  return <div className={className} onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: cleaned(source) }} />;
});

/*
  The Script Writer's Markdown. Any raw HTML in a reply is shown as text, not
  parsed: the reply is model output, and a prompt can steer what it says.
*/
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: { html: ({ text }) => escape(text) },
});

/** Markdown (the Script Writer's replies) as safe HTML. */
export function Markdown({ text, className = "rich md" }: { text: string; className?: string }) {
  const html = markdown.parse(text, { async: false }) as string;
  return <RichText html={html} className={className} />;
}
