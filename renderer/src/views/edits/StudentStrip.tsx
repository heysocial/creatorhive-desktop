import { Clapperboard, SquareKanban } from "lucide-react";
import { formatDueDate, openCard, planLabel, useCardForMember, type BoardCard } from "../../lib/videoEdits";
import { VideoStill } from "./Player";
import { StagePill } from "./VideoEdits";

/*
  Staff only (the board answers 404 to everyone else, so these draw nothing):
  a student with videos to edit is labelled in Messages ("Weekend Starter" or
  "UGC Starter", rose), and her chat gets a strip with her card at a glance.
*/

export function StudentLabel({ memberId, card: given }: { memberId?: string; card?: BoardCard | null }) {
  const found = useCardForMember(given ? null : memberId);
  const card = given ?? found;
  if (!card) return null;
  return <span className="ve-plan" title="Has videos with the editor"><Clapperboard />{planLabel(card.member.plan)}</span>;
}

export function StudentStrip({ memberId }: { memberId: string }) {
  const card = useCardForMember(memberId);
  if (!card) return null;
  return (
    <div className="ve-strip">
      <span className="ve-strip-thumbs">
        {[1, 2, 3].map((slot) => {
          const url = card.thumbnails.find((t) => t.slot === slot)?.url;
          return <VideoStill key={slot} thumbnailUrl={url} label={url ? undefined : String(slot)} />;
        })}
      </span>
      <b>Her 3 videos</b>
      <StagePill stage={card.stage} small />
      <span className="faint ve-strip-line">{[card.dueOn ? `Due ${formatDueDate(card.dueOn)}` : null, card.progress].filter(Boolean).join(" · ")}</span>
      <button className="btn" onClick={() => openCard(card.id)}><SquareKanban />Open her card</button>
    </div>
  );
}
