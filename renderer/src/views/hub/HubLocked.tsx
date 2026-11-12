import { Lock } from "lucide-react";
import { ch } from "../../lib/bridge";
import { nav } from "../../lib/nav";
import { useMeAccess } from "../../lib/access";
import { AcademyIncludes, upgradeUrlOf } from "../../shell/Upgrade";

/**
 * What a Hub view shows on a plan without the Hub (The Weekend Starter): a
 * link, a shortcut (⌘3) or a remembered place lands here instead of a screen
 * that would only fail to load. Nothing of the Hub is asked for. Same list and
 * button as the "Part of the UGC Academy" sheet (shell/Upgrade.tsx).
 */
export function HubLocked() {
  const access = useMeAccess().data?.access;
  const url = upgradeUrlOf(access);
  return (
    <div className="convo">
      <div className="convo-main">
        <div className="soon-screen academy-screen">
          <div className="soon-card academy-locked">
            <div className="soon-icon" aria-hidden><Lock /></div>
            <h2>Part of the UGC Academy</h2>
            <p className="soon-description">Here's everything the UGC Academy includes:</p>
            <AcademyIncludes access={access} />
            <div className="academy-locked-actions">
              <button className="btn honey" onClick={() => ch.app.openExternal(url)}>Talk to our team</button>
              <button className="btn" onClick={() => nav.open({ kind: "learn", page: "improve" }, "learn", "ch")}>Open Learn</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
