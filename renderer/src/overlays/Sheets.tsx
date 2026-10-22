import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { ch, type SessionUser } from "../lib/bridge";
import { commands } from "../lib/commands";

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
const SHORTCUTS: [string, [string, string][]][] = [
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
  ["Workspaces", [
    ["CreatorHive", "⌃⌘1"],
    ["Hey Social Inc.", "⌃⌘2"],
  ]],
  ["Window", [
    ["Toggle sidebar", "⌃⌘S"],
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

export function SettingsSheet({ user, version, onClose }: { user: SessionUser; version: string; onClose: () => void }) {
  return (
    <Sheet title="Settings" onClose={onClose} width={480}>
      <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
        <div><div className="faint" style={{ fontSize: 12 }}>Signed in as</div><b>{user.name}</b> <span className="muted">{user.email}</span></div>
        <p className="muted" style={{ lineHeight: 1.5 }}>
          The Settings window (notifications, Dock badge, sound and more) comes in Phase 4. Until then, notifications are
          set from the menu bar icon, and your account settings are on the website.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => ch.app.openSite("/settings")}>Open settings on the website</button>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => { onClose(); commands.run("sign-out"); }}>Sign out</button>
        </div>
        <div className="faint" style={{ fontSize: 12 }}>Version {version}</div>
      </div>
    </Sheet>
  );
}
