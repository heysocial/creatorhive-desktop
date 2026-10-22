import { useEffect, useRef } from "react";
import { EMOJI_GROUPS, QUICK_REACTIONS } from "../../lib/emoji";

/** A small popover of emoji. Closes on a pick, Escape or a click elsewhere. */
export function EmojiPicker({ onPick, onClose, placement = "below" }: { onPick: (emoji: string) => void; onClose: () => void; placement?: "above" | "below" }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={box} className={`emoji-pop ${placement}`} role="dialog" aria-label="Emoji">
      <div className="emoji-quick">
        {QUICK_REACTIONS.map((e) => <button key={e} onClick={() => onPick(e)}>{e}</button>)}
      </div>
      <div className="emoji-scroll">
        {EMOJI_GROUPS.map(([group, list]) => (
          <div key={group}>
            <div className="emoji-group">{group}</div>
            <div className="emoji-grid">{list.map((e) => <button key={e} onClick={() => onPick(e)}>{e}</button>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
