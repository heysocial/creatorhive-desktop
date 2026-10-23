import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

function Sheet({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title} style={width ? { width } : undefined}>
        <div className="sheet-head">{title}<button className="iconbtn" aria-label="Close" onClick={onClose}><X /></button></div>
        {children}
      </div>
    </div>
  );
}

/* Only shortcuts that work today. Each phase adds its own. */
export const SHORTCUTS: [string, [string, string][]][] = [
  ["Getting around", [
    ["Search and jump anywhere", "⌘K"],
    ["Back", "⌘["],
    ["Forward", "⌘]"],
    ["Home", "⌘1"],
    ["DMs", "⌘2"],
    ["Hub", "⌘3"],
    ["Learn", "⌘4"],
    ["Activity", "⌘5"],
    ["Previous or next item in the sidebar", "⌥↑ / ⌥↓"],
    ["Previous or next unread", "⌥⇧↑ / ⌥⇧↓"],
  ]],
  ["Messages", [
    ["New message", "⌘N"],
    ["New post on Home", "⇧⌘N"],
    ["Open the conversation in its own window", "⇧⌘O"],
    ["Send", "Return"],
    ["New line", "⇧Return"],
    ["Bold, italic, strikethrough", "⌘B, ⌘I, ⇧⌘X"],
    ["Link", "⇧⌘U"],
    ["Edit (in the message's menu)", "Right-click"],
    ["Close a thread or panel", "Esc"],
  ]],
  ["Learn", [
    ["Play or pause the lesson video", "Space"],
    ["Back or forward 10 seconds", "J / L"],
    ["Mark the lesson complete", "⌘↩"],
    ["Note this moment in the lesson", "⇧⌘N"],
  ]],
  ["Creator Hub", [
    ["New deal", "⌥⌘N"],
    ["Export deals", "⇧⌘E"],
    ["Edit the open deal", "⌘E"],
    ["Move a deal", "Drag it to another stage"],
    ["Close the deal", "Esc"],
  ]],
  ["Hey Social Inc.", [
    ["Mute or unmute the huddle, from any app", "⇧⌘Space"],
    ["Save a message for later", "Hover it, then the bookmark"],
  ]],
  ["Workspaces", [
    ["CreatorHive", "⌃⌘1"],
    ["Hey Social Inc.", "⌃⌘2"],
  ]],
  ["Window", [
    ["Show or hide sidebar", "⇧⌘D"],
    ["Full screen", "⌃⌘F"],
    ["Close window (CreatorHive keeps running)", "⌘W"],
    ["Settings", "⌘,"],
    ["This list", "⌘/"],
  ]],
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" onClose={onClose} width={500}>
      <div className="shortcuts">
        {SHORTCUTS.map(([group, rows]) => (
          <div key={group} style={{ display: "contents" }}>
            <h3>{group}</h3>
            {rows.map(([label, keys]) => <div key={label} className="sc">{label}<kbd>{keys}</kbd></div>)}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
