import { Lock } from "lucide-react";
import { ch } from "../../lib/bridge";
import { nav } from "../../lib/nav";
import { useMeAccess } from "../../lib/access";

/**
 * What a Hub view shows on a plan without the Hub (The Weekend Starter): a
 * link, a shortcut (⌘3) or a remembered place lands here instead of a screen
 * that would only fail to load. Nothing of the Hub is asked for.
 */
export function HubLocked() {
  const access = useMeAccess().data?.access;
  const url = access?.upgradeUrl ?? "https://cal.com/team/creatorhive/skool";
  const plan = access?.plan === "first3" ? "The Weekend Starter" : "Your plan";
  return (
    <div className="convo">
      <div className="convo-main">
        <div className="soon-screen">
          <div className="soon-card">
            <div className="soon-icon" aria-hidden><Lock /></div>
            <div className="soon-name">The Creator Hub is part of the UGC Academy</div>
            <p className="soon-description">{plan} is about your first 3 videos. Your course and your track are in Learn.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button className="btn honey" onClick={() => nav.open({ kind: "learn", page: "improve" }, "learn", "ch")}>Open Learn</button>
              <button className="btn" onClick={() => ch.app.openExternal(url)}>Talk to our team</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
