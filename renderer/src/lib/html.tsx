import { memo, type MouseEvent } from "react";
import { marked } from "marked";
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

function clean(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (!TAGS.has(child.tagName)) {
        // Keep the words of anything unknown, drop the element.
        if (child.tagName === "SCRIPT" || child.tagName === "STYLE" || child.tagName === "IFRAME") child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = ATTRS[child.tagName] ?? new Set<string>();
      for (const attr of [...child.attributes]) if (!allowed.has(attr.name)) child.removeAttribute(attr.name);
      if (child.tagName === "A") {
        const href = child.getAttribute("href") ?? "";
        if (!/^(https?:|mailto:|\/)/i.test(href)) child.removeAttribute("href");
      }
      walk(child);
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

/** Markdown (the Script Writer's replies) as safe HTML. */
export function Markdown({ text, className = "rich md" }: { text: string; className?: string }) {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  return <RichText html={html} className={className} />;
}
