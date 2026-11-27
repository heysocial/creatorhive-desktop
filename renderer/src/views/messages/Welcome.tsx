import { useState } from "react";
import { MessageCircle, PlayCircle, Sparkles, VideoOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, type Conversation } from "../../lib/api";
import { embedFor } from "../../lib/learn";
import { Avatar } from "../../lib/ui";
import { Modal } from "../hub/parts";
import { messagePerson } from "../people/Profile";

/*
  The Welcome channel's Get started (docs/academy-onboarding-nov27.md §3): a
  card above the messages, and a two-step dialog from GET /api/welcome —
  "Watch this video", then "Meet our team" with a Message button per person.
*/

interface WelcomeInfo {
  video: { url: string | null; embedUrl: string | null };
  team: { userId: string; name: string; role: string; avatarUrl: string | null }[];
}

export function GetStartedCard({ meId, popout }: { meId: string; popout: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="card welcome-start">
        <span className="t-ico honey"><Sparkles /></span>
        <span className="welcome-start-text"><b>New here? Start here.</b><small>A short video, then meet the team behind CreatorHive.</small></span>
        <button className="btn honey" onClick={() => setOpen(true)}>Get started</button>
      </div>
      {open ? <GetStarted meId={meId} popout={popout} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const STEPS = ["Watch this video", "Meet our team"] as const;

function GetStarted({ meId, popout, onClose }: { meId: string; popout: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const info = useQuery({ queryKey: ["welcome"], staleTime: 5 * 60_000, queryFn: () => api<WelcomeInfo>("/api/welcome") });
  const last = step === STEPS.length - 1;
  const foot = (
    <>
      <span className="faint welcome-steps">Step {step + 1} of {STEPS.length}</span>
      {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>Back</button> : null}
      <button className="btn honey" onClick={() => (last ? onClose() : setStep(step + 1))}>{last ? "Done" : "Next"}</button>
    </>
  );
  return (
    <Modal title={STEPS[step]} onClose={onClose} width={560} foot={foot}>
      {info.isError ? <div className="err-state">Couldn't load this. <button className="link" onClick={() => void info.refetch()}>Try again</button></div>
        : step === 0 ? <WelcomeVideo info={info.data} />
        : <Team info={info.data} meId={meId} onMessage={(id) => {
          onClose();
          // A pop-out window opens the DM in the main window, as its other links do.
          if (!popout) { void messagePerson(id); return; }
          void api<{ conversation: Conversation }>("/api/dms", { method: "POST", body: { userId: id } })
            .then(({ conversation }) => ch.app.openMain(`dm:${conversation.id}`))
            .catch(() => window.alert("You can't message this person right now."));
        }} />}
    </Modal>
  );
}

function WelcomeVideo({ info }: { info: WelcomeInfo | undefined }) {
  if (!info) return <div className="player empty" />;
  const { url, embedUrl } = info.video;
  if (!url) return <div className="player empty"><PlayCircle />Video coming soon</div>;
  const embed = embedFor(url, embedUrl, "welcome");
  if (!embed) {
    return <div className="player empty"><VideoOff />This video's link isn't one we can play. <button className="link" onClick={() => ch.app.openExternal(url)}>Open it in the browser</button></div>;
  }
  return (
    <div className="player">
      <iframe src={embed.src} title="Welcome to CreatorHive" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  );
}

function Team({ info, meId, onMessage }: { info: WelcomeInfo | undefined; meId: string; onMessage: (userId: string) => void }) {
  if (!info) return <div className="msgs-skel">{Array.from({ length: 3 }, (_, i) => <div key={i} />)}</div>;
  if (!info.team.length) return <p className="muted">The team will be here soon.</p>;
  return (
    <div className="welcome-team">
      {info.team.map((person) => (
        <div key={person.userId} className="t-card static">
          <Avatar name={person.name} src={person.avatarUrl} seed={person.userId} size={40} radius="10px" />
          <span><b>{person.name}</b><small>{person.role}</small></span>
          {person.userId !== meId ? <button className="btn" onClick={() => onMessage(person.userId)}><MessageCircle />Message</button> : null}
        </div>
      ))}
    </div>
  );
}
