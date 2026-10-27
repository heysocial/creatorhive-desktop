import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Avatar } from "../../lib/ui";
import type { MentionCandidate } from "./Composer";

/*
  The Composer's @ list for a plain text box (post comments): type "@" and a
  name, pick with the mouse, ↑/↓ and Return or Tab. Picked people whose
  "@Full Name" is still in the text are the mentions sent with it.
*/
export function useMentionPicker({ value, setValue, input, searchPeople }: {
  value: string;
  setValue: (next: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  searchPeople: (query: string) => MentionCandidate[];
}) {
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const caretAfter = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caretAfter.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [value]);

  const candidates = useMemo(() => (mention ? searchPeople(mention.query).slice(0, 8) : []), [mention, searchPeople]);

  /** After each change: is the caret right after "@name"? */
  function track(next: string, caret: number) {
    const match = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(next.slice(0, caret));
    if (match) {
      setMention({ start: caret - match[2].length - 1, query: match[2] });
      setIndex(0);
    } else {
      setMention(null);
    }
  }

  function pick(person: MentionCandidate) {
    if (!mention) return;
    const caret = input.current?.selectionStart ?? value.length;
    const text = `@${person.name} `;
    caretAfter.current = mention.start + text.length;
    setValue(value.slice(0, mention.start) + text + value.slice(caret));
    setPicked((current) => (current.some((p) => p.id === person.id) ? current : [...current, person]));
    setMention(null);
  }

  /** True when the list used the key. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || candidates.length === 0) return false;
    if (event.key === "ArrowDown") setIndex((i) => (i + 1) % candidates.length);
    else if (event.key === "ArrowUp") setIndex((i) => (i - 1 + candidates.length) % candidates.length);
    else if (event.key === "Enter" || event.key === "Tab") pick(candidates[index]);
    else if (event.key === "Escape") { event.stopPropagation(); setMention(null); }
    else return false;
    event.preventDefault();
    return true;
  }

  const list = mention && candidates.length > 0 ? (
    <div className="mention-list" role="listbox">
      {candidates.map((person, i) => (
        <button key={person.id} className={i === index ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pick(person); }}>
          <Avatar name={person.name} src={person.avatarUrl} seed={person.id} size={22} radius="6px" />
          <b>{person.name}</b>{person.sub ? <span>{person.sub}</span> : null}
        </button>
      ))}
    </div>
  ) : null;

  return {
    track,
    onKeyDown,
    list,
    /** The picked people still named in `body`. */
    mentionIds: (body: string) => picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id),
    reset: () => { setPicked([]); setMention(null); },
  };
}
