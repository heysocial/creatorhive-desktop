/**
 * Splits plain text into text and links, for free text people type: a deal's
 * notes and its updates. A link starts with http://, https:// or www.; a full
 * stop, comma or closing bracket at its end belongs to the sentence, not the
 * link. Mirrored in the iPhone app (components/messages/LinkifiedText.tsx) and
 * the website (lib/text/linkify.ts, where this is copied from).
 */

export type LinkPart = { text: string; href?: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?'")\]]+$/;

export function splitLinks(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    let link = raw.replace(TRAILING, "");
    // Keep a closing bracket the link itself opened: en.wikipedia.org/wiki/Foo_(bar).
    const opened = (link.match(/\(/g) ?? []).length - (link.match(/\)/g) ?? []).length;
    if (opened > 0 && raw.slice(link.length).startsWith(")")) link += ")";
    const start = match.index ?? 0;
    // "www." alone, or a scheme with nothing after it, is not a link.
    if (/^(?:https?:\/\/|www\.)$/i.test(link)) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: link, href: /^www\./i.test(link) ? `https://${link}` : link });
    last = start + link.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
