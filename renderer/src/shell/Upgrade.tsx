import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { ch } from "../lib/bridge";
import { useMeAccess, type MeAccess } from "../lib/access";
import { Modal } from "../views/hub/parts";

/*
  "Part of the UGC Academy": the one sheet every locked thing opens (the rail's
  Hub, locked sidebar rows, courses, feed tabs, Improve tiles), with the full
  list of what the UGC Academy includes and "Talk to our team" under it.
  Same copy as the website and the phones: creatorhive-app docs/academy-includes.md.
*/

export const UPGRADE_FALLBACK_URL = "https://cal.com/team/creatorhive/skool";

/** Rows 2–10, as the website's lib/access.ts ACADEMY_INCLUDES_REST. */
const ACADEMY_INCLUDES_REST = [
  "Live group coaching calls and events",
  "5 calls per week with the community at your level",
  "A 1-on-1 accountability coach",
  "All channels and DMs with the whole community: message any creator in the Hive",
  "The CreatorHive financial dashboard (Creator Hub)",
  "Job board and brand deals",
  "Unlimited AI Script Writer",
  "Unlimited AI Video Editor",
  "Unlimited AI Sales Agent that finds brands for you and applies on every platform",
];

/**
 * The list: the server's (`access.academyIncludes`) when it sends a non-empty
 * list of strings, so a wording change needs no release; else the built-in
 * copy, its first line naming the plan's own course.
 */
export function academyIncludes(access: Pick<MeAccess, "plan"> & { academyIncludes?: unknown } | undefined): string[] {
  const sent = access?.academyIncludes;
  if (Array.isArray(sent) && sent.length > 0 && sent.every((item) => typeof item === "string" && item.trim() !== "")) return sent as string[];
  const course = access?.plan === "first3" ? "The Weekend Starter" : "New Bee";
  return [`Every course, not just ${course}`, ...ACADEMY_INCLUDES_REST];
}

export function upgradeUrlOf(access: MeAccess | undefined): string {
  return access?.upgradeUrl || UPGRADE_FALLBACK_URL;
}

/** The checklist, a check per row. */
export function AcademyIncludes({ access }: { access: MeAccess | undefined }) {
  return <ul className="academy-list">{academyIncludes(access).map((item) => <li key={item}><Check aria-hidden />{item}</li>)}</ul>;
}

/** The sheet itself. An ended plan keeps its own title and sentence. */
export function UpgradeDialog({ onClose }: { onClose: () => void }) {
  const access = useMeAccess().data?.access;
  const url = upgradeUrlOf(access);
  const ended = access?.state === "starter_ended";
  const planName = access?.plan === "first3" ? "Weekend Starter" : "UGC Starter";
  const hubOpen = !(Array.isArray(access?.locked) && access.locked.includes("hub"));
  const title = ended ? `Your ${planName} has ended` : "Part of the UGC Academy";
  return (
    <Modal width={440} onClose={onClose} foot={
      <div className="upgrade-foot">
        <button className="btn honey lg" onClick={() => { ch.app.openExternal(url); onClose(); }}>Talk to our team</button>
        <button className="btn ghost" onClick={onClose}>Not now</button>
      </div>
    }>
      <div className="upgrade" aria-label={title}>
        <span className="upgrade-mark"><Lock /></span>
        <h2>{title}</h2>
        <p className="muted">
          {ended
            ? hubOpen
              ? "Your Hub and your deals are still here. Join the UGC Academy to pick up where you left off."
              : "Your account and Settings are still here. Talk to our team about joining the UGC Academy."
            : "Here's everything the UGC Academy includes:"}
        </p>
        <AcademyIncludes access={access} />
      </div>
    </Modal>
  );
}

/** Mounted once in the app: openUpgrade() (lib/access.ts) shows the sheet from anywhere. */
export function UpgradeHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("ch:upgrade", show);
    return () => window.removeEventListener("ch:upgrade", show);
  }, []);
  return open ? <UpgradeDialog onClose={() => setOpen(false)} /> : null;
}
