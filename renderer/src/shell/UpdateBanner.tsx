import { RefreshCw, X } from "lucide-react";
import { ch } from "../lib/bridge";

/*
  A new version has downloaded: say so and offer the restart now, rather than
  leaving it for the next time someone quits. Later hides it until the next
  launch; the CreatorHive menu and the menu bar icon keep Restart to Update.
*/
export function UpdateBanner({ version, onLater }: { version: string; onLater: () => void }) {
  return (
    <div className="update-banner" role="status">
      <RefreshCw className="icon" />
      <span className="text"><b>Update ready</b><small>CreatorHive {version}</small></span>
      <button className="btn honey" onClick={() => ch.app.installUpdate()}>Restart</button>
      <button className="iconbtn" aria-label="Later" title="Later" onClick={onLater}><X /></button>
    </div>
  );
}
