import { ArrowLeft, ArrowRight, CircleHelp, Search } from "lucide-react";
import { commands } from "../lib/commands";
import { nav, useNav } from "../lib/nav";
import { useConnectionState } from "../lib/realtime";

export function TopBar({ preview, updateReady }: { preview: boolean; updateReady: string | null }) {
  useNav(); // re-render when history changes, for the back/forward buttons
  const connection = useConnectionState();
  const ws = nav.get().ws;
  const reconnecting = connection === "disconnected" || connection === "suspended" || connection === "connecting";

  return (
    <header className="topbar">
      <div className="navbtns">
        <button className="iconbtn" aria-label="Back" title="Back (⌘[)" disabled={!nav.canGoBack()} onClick={() => nav.back()}><ArrowLeft /></button>
        <button className="iconbtn" aria-label="Forward" title="Forward (⌘])" disabled={!nav.canGoForward()} onClick={() => nav.forward()}><ArrowRight /></button>
      </div>
      <button className="search-trigger" onClick={() => commands.run("quick-open")}>
        <Search />
        <span>{ws === "hs" ? "Search Hey Social Inc." : "Search CreatorHive"}</span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="topright">
        {reconnecting ? <span className="conn" title="Live updates are reconnecting"><i />Reconnecting…</span> : null}
        {updateReady ? (
          <button className="btn honey" style={{ height: 26, fontSize: 12 }} onClick={() => window.ch.app.installUpdate()}>
            Restart to update
          </button>
        ) : null}
        {preview ? <span className="preview-tag" title="The team's preview of CreatorHive 2.0">PREVIEW</span> : null}
        <button className="iconbtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (⌘/)" onClick={() => commands.run("shortcuts")}><CircleHelp /></button>
      </div>
    </header>
  );
}
