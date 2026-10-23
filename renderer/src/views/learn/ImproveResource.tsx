import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, CircleAlert, Clipboard, LibraryBig, Loader2, Play, Search, Send, Sparkles, TriangleAlert, X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { nav } from "../../lib/nav";
import "../../styles/improve.css";

/*
  An Improve resource (the website's /library/resources/<slug>), drawn in the
  app from /api/improve/resources/content — the same payload the iPhone app
  renders. Content, order and copy follow the website's renderers in
  components/improve/*; nothing here is written down locally.
*/

/* ------------------------------------------------------------------ shapes */

type Resource = {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  icon: string;
  flagship?: boolean;
  mode: string;
  contentId?: string;
  externalUrl?: string;
};

type ProgressItem = { key: string; label: string };
type GlossaryTerm = { term: string; definition: string; tier?: boolean };
type AgencyType = "agency" | "platform" | "both";
type AgencyLevel = "new" | "hustle" | "pro" | "all";
type AgencyEntry = { name: string; signupUrl: string; type: AgencyType | null; level: AgencyLevel | null; domain: string; logoUrl: string | null; faviconUrl: string };
type LoomVideo = { shareUrl: string; thumbnailUrl: string | null; durationSeconds: number | null; aspectRatio: number | null };
type TemplatedScriptSection = { id: string; title: string; groups: { title: string; note?: string; scripts: { title: string; text: string; context?: string }[] }[] };
type SwipeSection = { id: string; title: string; countLabel: string; groups: { title: string; items: string[] }[] };
type CameraStep = { number: number; title: string; settingPath?: string; setTo?: string; why: string; image?: { src: string; alt: string; width: number; height: number } };

type Content = {
  resources: Resource[];
  "plug-and-play-email-scripts"?: { subjectLines: string[]; initialOutreach: string; followUpOne: string; followUpTwo: string };
  "10-video-prompts-challenge"?: { howItWorks: string[]; prompts: ProgressItem[]; actionSteps: string[]; benefits: string[]; selfReview: ProgressItem[] };
  "bulletproof-script-prompt-template"?: { loom: LoomVideo; prompt: string };
  "brand-outreach-manual"?: { loom: LoomVideo };
  "ugc-glossary"?: { terms: GlossaryTerm[] };
  "templated-scripts"?: { sections: TemplatedScriptSection[] };
  "agencies-and-platforms"?: { entries: AgencyEntry[] };
  "camera-settings-manual-iphone"?: {
    stream: { hlsUrl?: string | null; posterUrl?: string | null; customerHost?: string; uid?: string };
    steps: CameraStep[];
    nextSteps: string[];
    monitorUrl: string;
  };
  "cold-email-subject-lines-hooks-ctas"?: { sections: SwipeSection[] };
};

const useResourceContent = () => useQuery({
  queryKey: ["improve-resource-content"],
  // Identical for everyone and only changes on a deploy.
  staleTime: 60 * 60_000,
  queryFn: async () => (await api<{ content: Content }>("/api/improve/resources/content")).content,
});

/** The website's origin, for the camera manual's step screenshots (paths into its public/). */
const useSiteOrigin = () => useQuery({ queryKey: ["app-info"], staleTime: Infinity, queryFn: () => ch.info() }).data?.origin ?? null;

const pad = (n: number) => String(n).padStart(2, "0");
const backToImprove = () => nav.open({ kind: "learn", page: "improve" }, "learn", "ch");

/* -------------------------------------------------------------------- page */

export function ImproveResource({ slug }: { slug: string }) {
  const { data, isLoading, error } = useResourceContent();
  const resource = data?.resources.find((r) => r.slug === slug) ?? null;

  return (
    <div className="page ir-page">
      <div className="mhead">
        <button className="btn ir-back" onClick={backToImprove} title="Back to Improve"><ArrowLeft />Improve</button>
        <h1>{resource?.title ?? (isLoading ? "" : "Resource")}</h1>
        {resource ? <span className="sub">{resource.description}</span> : null}
      </div>
      <div className="scroll page-body ir-body">
        {isLoading ? <div className="empty-state"><span><Loader2 className="spin" /> Loading…</span></div> : null}
        {error ? (
          <div className="empty-state">
            <div className="ir-state">
              <p>{error instanceof ApiError && error.status === 403 ? "Improve resources aren't included in your plan." : "Couldn't load this resource."}</p>
              {!(error instanceof ApiError && error.status === 403) ? (
                <button className="btn" onClick={() => void queryClient.invalidateQueries({ queryKey: ["improve-resource-content"] })}>Try again</button>
              ) : null}
            </div>
          </div>
        ) : null}
        {data && !resource ? (
          <div className="empty-state"><div className="ir-state"><p>This resource isn't available.</p><button className="btn" onClick={backToImprove}>Back to Improve</button></div></div>
        ) : null}
        {data && resource ? (
          <article className="ir-content">
            <header className="ir-hero">
              <span className="section-label">{resource.type}</span>
              <h2>{resource.title}</h2>
              <p className="muted">{resource.description}</p>
            </header>
            <ResourceBody resource={resource} content={data} />
          </article>
        ) : null}
      </div>
    </div>
  );
}

function ResourceBody({ resource, content }: { resource: Resource; content: Content }) {
  if (resource.mode === "embed" && resource.externalUrl) return <EmbedBody resource={resource} />;
  if (resource.mode !== "content") return <ComingSoon resource={resource} />;

  switch (resource.contentId) {
    case "plug-and-play-email-scripts":
      return content[resource.contentId] ? <EmailScriptsBody data={content[resource.contentId]!} /> : <ComingSoon resource={resource} />;
    case "10-video-prompts-challenge":
      return content[resource.contentId] ? <ChallengeBody slug={resource.slug} data={content[resource.contentId]!} /> : <ComingSoon resource={resource} />;
    case "bulletproof-script-prompt-template":
      return content[resource.contentId] ? <BulletproofBody data={content[resource.contentId]!} /> : <ComingSoon resource={resource} />;
    case "brand-outreach-manual":
      return content[resource.contentId] ? <BrandOutreachBody data={content[resource.contentId]!} /> : <ComingSoon resource={resource} />;
    case "ugc-glossary":
      return content[resource.contentId] ? <GlossaryBody terms={content[resource.contentId]!.terms} /> : <ComingSoon resource={resource} />;
    case "templated-scripts":
      return content[resource.contentId] ? <TemplatedScriptsBody sections={content[resource.contentId]!.sections} /> : <ComingSoon resource={resource} />;
    case "agencies-and-platforms":
      return content[resource.contentId] ? <AgenciesBody entries={content[resource.contentId]!.entries} /> : <ComingSoon resource={resource} />;
    case "camera-settings-manual-iphone":
      return content[resource.contentId] ? <CameraSettingsBody data={content[resource.contentId]!} /> : <ComingSoon resource={resource} />;
    case "cold-email-subject-lines-hooks-ctas":
      return content[resource.contentId] ? <ColdEmailBody sections={content[resource.contentId]!.sections} /> : <ComingSoon resource={resource} />;
    default:
      return <ComingSoon resource={resource} />;
  }
}

/* ------------------------------------------------------------------ shared */

function Section({ eyebrow, title, aside, intro, className, children }: { eyebrow?: string; title: ReactNode; aside?: ReactNode; intro?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`card ir-section ${className ?? ""}`}>
      <header className="ir-sec-head">
        <div>
          {eyebrow ? <span className="section-label">{eyebrow}</span> : null}
          <h3>{title}</h3>
          {intro ? <p className="muted">{intro}</p> : null}
        </div>
        {aside ? <strong className="ir-sec-aside">{aside}</strong> : null}
      </header>
      {children}
    </section>
  );
}

function Intro({ eyebrow, title, text, icon }: { eyebrow: string; title: string; text: string; icon?: ReactNode }) {
  return (
    <header className="card ir-intro">
      <div>
        <span className="section-label">{eyebrow}</span>
        <h3>{title}</h3>
        <p className="muted">{text}</p>
      </div>
      {icon ? <span className="t-ico honey ir-intro-ico">{icon}</span> : null}
    </header>
  );
}

type CopyState = "idle" | "copied" | "error";

function CopyBlock({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  return (
    <div className={`ir-copy ${state}`}>
      <pre className="selectable">{text}</pre>
      <button className="btn ir-copy-btn" onClick={() => void copy()} aria-label={`Copy ${label}`}>
        {state === "copied" ? <Check /> : state === "error" ? <TriangleAlert /> : <Clipboard />}
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "error" ? "Try again" : "Copy"}</span>
      </button>
    </div>
  );
}

function loomEmbedUrl(shareUrl: string): string | null {
  try {
    const url = new URL(shareUrl);
    if (url.protocol !== "https:" || !["loom.com", "www.loom.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/share\/([a-zA-Z0-9]+)\/?$/);
    return match ? `https://www.loom.com/embed/${match[1]}` : null;
  } catch {
    return null;
  }
}

function LoomEmbed({ loom, title }: { loom: LoomVideo; title: string }) {
  const src = loomEmbedUrl(loom.shareUrl);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (loaded || !src) return;
    const timeout = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timeout);
  }, [loaded, src]);

  return (
    <div className="ir-video">
      <div className="ir-frame" style={{ aspectRatio: String(loom.aspectRatio ?? 16 / 9) }}>
        {!loaded || !src ? (
          <div className="ir-frame-state">
            {slow || !src ? (
              <><CircleAlert /><b>The video is taking longer to load.</b><span className="muted">Watch it directly on Loom.</span></>
            ) : (
              <><Loader2 className="spin" /><span className="muted">Loading the Loom video…</span></>
            )}
          </div>
        ) : null}
        {src ? (
          <iframe
            src={src}
            title={title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => { setLoaded(true); setSlow(false); }}
          />
        ) : null}
      </div>
      <button className="link ir-ext" onClick={() => ch.app.openExternal(loom.shareUrl)}>Watch on Loom<ArrowUpRight /></button>
    </div>
  );
}

/** A Mux walkthrough: HLS through hls.js (Chromium has no native HLS), as message videos play. */
function HlsVideo({ hlsUrl, posterUrl, title, aspect }: { hlsUrl: string; posterUrl: string | null; title: string; aspect: number }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const element = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!playing || !element.current) return;
    let destroyed = false;
    let hls: { destroy(): void } | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed || !element.current) return;
      if (Hls.isSupported()) {
        const instance = new Hls();
        instance.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
        instance.loadSource(hlsUrl);
        instance.attachMedia(element.current);
        hls = instance;
      } else {
        element.current.src = hlsUrl;
      }
      void element.current.play().catch(() => {});
    }).catch(() => setFailed(true));
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [playing, hlsUrl]);

  return (
    <div className="ir-hls" style={{ aspectRatio: String(aspect) }}>
      {failed ? (
        <div className="ir-frame-state"><CircleAlert /><b>This video couldn't play.</b></div>
      ) : playing ? (
        <video ref={element} controls playsInline poster={posterUrl ?? undefined} aria-label={title} />
      ) : (
        <button className="ir-poster" onClick={() => setPlaying(true)} aria-label={`Play ${title}`}>
          {posterUrl ? <img src={posterUrl} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
          <span className="ir-play"><Play /></span>
        </button>
      )}
    </div>
  );
}

function EmbedBody({ resource }: { resource: Resource }) {
  return (
    <section className="card ir-section ir-embed">
      <span className="t-ico honey"><Sparkles /></span>
      <p className="muted">{resource.title} opens in your browser.</p>
      <button className="btn honey" onClick={() => ch.app.openExternal(resource.externalUrl!)}>Open {resource.title}<ArrowUpRight /></button>
    </section>
  );
}

function ComingSoon({ resource }: { resource: Resource }) {
  return (
    <section className="card ir-section ir-embed">
      <span className="section-label">{resource.type}</span>
      <h3>Coming soon</h3>
      <p className="muted">We're preparing <b>{resource.title}</b> for your Improve toolkit.</p>
      <button className="btn" onClick={backToImprove}>Back to Improve</button>
    </section>
  );
}

function SearchBar({ value, onChange, placeholder, count }: { value: string; onChange: (value: string) => void; placeholder: string; count?: string }) {
  return (
    <label className="ir-search">
      <Search />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
      {value ? <button onClick={() => onChange("")} aria-label="Clear search"><X /></button> : null}
      {count ? <strong aria-live="polite">{count}</strong> : null}
    </label>
  );
}

function useOpenSections(firstId: string | undefined) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(firstId ? [firstId] : []));
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return { open, toggle };
}

function Accordion({ index, title, count, expanded, onToggle, children }: { index: number; title: string; count: string; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`card ir-acc ${expanded ? "open" : ""}`}>
      <button className="ir-acc-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="ir-acc-num">{pad(index + 1)}</span>
        <span className="ir-acc-title">{title}</span>
        <span className="ir-acc-count">{count}</span>
        <ChevronDown className="ir-chev" />
      </button>
      {expanded ? <div className="ir-acc-panel">{children}</div> : null}
    </section>
  );
}

/* ------------------------------------------------ plug-and-play email scripts */

function EmailScriptsBody({ data }: { data: NonNullable<Content["plug-and-play-email-scripts"]> }) {
  return (
    <>
      <Section eyebrow="Start the conversation" title="Subject Lines">
        <div className="ir-stack">
          {data.subjectLines.map((subject, index) => <CopyBlock key={subject} text={subject} label={`subject line ${index + 1}`} />)}
        </div>
      </Section>
      <Section eyebrow="Make the first move" title="Initial Outreach Message"><CopyBlock text={data.initialOutreach} label="Initial Outreach Message" /></Section>
      <Section eyebrow="Stay on their radar" title="Follow-Up Email #1"><CopyBlock text={data.followUpOne} label="Follow-Up Email #1" /></Section>
      <Section eyebrow="One final nudge" title="Follow-Up Email #2"><CopyBlock text={data.followUpTwo} label="Follow-Up Email #2" /></Section>
      <p className="ir-note faint">Personalize the proof point, brand name, and sign-off before you send.</p>
    </>
  );
}

/* ----------------------------------------------------- 10 video prompts challenge */

function ChallengeBody({ slug, data }: { slug: string; data: NonNullable<Content["10-video-prompts-challenge"]> }) {
  const key = ["improve-resource-progress", slug];
  const progress = useQuery({
    queryKey: key,
    queryFn: async () => (await api<{ completedItemKeys: string[] }>(`/api/improve/resources/${slug}/progress`)).completedItemKeys,
  });
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const done = useMemo(() => new Set(progress.data ?? []), [progress.data]);

  async function toggle(itemKey: string) {
    if (pending.has(itemKey) || !progress.data) return;
    const completed = !done.has(itemKey);
    setError(null);
    setPending((p) => new Set(p).add(itemKey));
    // Optimistic, then the server's word; rolled back on failure.
    queryClient.setQueryData<string[]>(key, (keys = []) => (completed ? [...keys, itemKey] : keys.filter((k) => k !== itemKey)));
    try {
      await api(`/api/improve/resources/${slug}/progress`, { method: "PATCH", body: { itemKey, completed } });
    } catch {
      queryClient.setQueryData<string[]>(key, (keys = []) => (completed ? keys.filter((k) => k !== itemKey) : [...keys, itemKey]));
      setError("Couldn't save that. Try again.");
    } finally {
      setPending((p) => { const next = new Set(p); next.delete(itemKey); return next; });
    }
  }

  const videoCount = data.prompts.filter((item) => done.has(item.key)).length;
  const reviewCount = data.selfReview.filter((item) => done.has(item.key)).length;
  const disabled = !progress.data;

  const checkRow = (item: ProgressItem, number?: number) => (
    <button key={item.key} className={`ir-check ${done.has(item.key) ? "on" : ""}`} disabled={disabled || pending.has(item.key)} onClick={() => void toggle(item.key)}>
      <span className="box">{done.has(item.key) ? <Check /> : null}</span>
      {number ? <span className="ir-check-num">{pad(number)}</span> : null}
      <span className="ir-check-label">{item.label}</span>
    </button>
  );

  return (
    <>
      <Section eyebrow="Start here" title="🧭 How It Works">
        <ul className="ir-bullets">{data.howItWorks.map((line) => <li key={line}>{line}</li>)}</ul>
      </Section>

      <Section eyebrow="Your challenge" title="📋 Prompts" aside={`${videoCount}/${data.prompts.length} videos recorded`}>
        <span className="bar ir-progress"><i style={{ width: `${data.prompts.length ? (videoCount / data.prompts.length) * 100 : 0}%` }} /></span>
        <div className="ir-checks">{data.prompts.map((item, index) => checkRow(item, index + 1))}</div>
      </Section>

      <Section eyebrow="Turn reps into progress" title="🧪 Action Steps">
        <ol className="ir-steps">{data.actionSteps.map((line, index) => <li key={line}><span>{pad(index + 1)}</span><p>{line}</p></li>)}</ol>
      </Section>

      <Section eyebrow="What changes after 10 videos" title="🎯 What You’ll Gain">
        <div className="ir-benefits">
          {data.benefits.map((line) => <div key={line} className="ir-benefit"><span><Check /></span><p>{line}</p></div>)}
        </div>
      </Section>

      <Section eyebrow="Use after every take" title="✅ Self-Review Checklist" aside={`${reviewCount}/${data.selfReview.length} reviewed`}>
        <div className="ir-checks">{data.selfReview.map((item) => checkRow(item))}</div>
      </Section>

      {progress.isError ? <p className="ir-error">Couldn't load your progress.</p> : null}
      {error ? <p className="ir-error">{error}</p> : null}
      <p className="ir-note ir-finish"><Sparkles />Comfort comes from reps. Keep going.</p>
    </>
  );
}

/* --------------------------------------------- bulletproof script prompt template */

function BulletproofBody({ data }: { data: NonNullable<Content["bulletproof-script-prompt-template"]> }) {
  return (
    <>
      <Section eyebrow="Step 01" title="Watch the instructions 👇">
        <LoomEmbed loom={data.loom} title="Bulletproof Script Prompt Template walkthrough" />
      </Section>
      <Section eyebrow="Step 02" title="Template" intro="Paste this into the AI Script Writer or ChatGPT, then replace the brackets with your details.">
        <CopyBlock text={data.prompt} label="Bulletproof Script Prompt Template" />
      </Section>
    </>
  );
}

/* --------------------------------------------------------- brand outreach manual */

function BrandOutreachBody({ data }: { data: NonNullable<Content["brand-outreach-manual"]> }) {
  return (
    <Section title="Watch the training 👇">
      <LoomEmbed loom={data.loom} title="Brand Outreach Manual training" />
    </Section>
  );
}

/* ------------------------------------------------------------------ ugc glossary */

function GlossaryBody({ terms }: { terms: GlossaryTerm[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => (needle ? terms.filter(({ term, definition }) => `${term} ${definition}`.toLocaleLowerCase().includes(needle)) : terms),
    [terms, needle],
  );
  const count = needle ? `${filtered.length} ${filtered.length === 1 ? "result" : "results"}` : `${terms.length} terms`;

  return (
    <>
      <Intro eyebrow="Your UGC field guide" title="Find the language brands use" text="Search the glossary whenever a brief, contract, or campaign conversation gets unclear." icon={<BookOpen />} />
      <SearchBar value={query} onChange={setQuery} placeholder="Search terms or definitions…" count={count} />
      {filtered.length ? (
        <dl className="card ir-terms selectable">
          {filtered.map(({ term, definition, tier }) => (
            <div key={term} className={tier ? "tier" : undefined}><dt>{term}</dt><dd>{definition}</dd></div>
          ))}
        </dl>
      ) : (
        <div className="card ir-empty">
          <Search /><b>No matching terms</b><span className="muted">Try another word, phrase, or definition.</span>
          <button className="btn" onClick={() => setQuery("")}>Clear search</button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- templated scripts */

function TemplatedScriptsBody({ sections }: { sections: TemplatedScriptSection[] }) {
  const { open, toggle } = useOpenSections(sections[0]?.id);
  const countOf = (section: TemplatedScriptSection) => section.groups.reduce((sum, group) => sum + group.scripts.length, 0);
  const total = sections.reduce((sum, section) => sum + countOf(section), 0);

  return (
    <>
      <Intro eyebrow={`${total} ready-to-personalize scripts`} title="Say the right thing at every deal stage" text="Open a section, choose the situation that matches, then copy and personalize the script." icon={<LibraryBig />} />
      <div className="ir-stack">
        {sections.map((section, index) => {
          const count = countOf(section);
          return (
            <Accordion key={section.id} index={index} title={section.title} count={`${count} ${count === 1 ? "script" : "scripts"}`} expanded={open.has(section.id)} onToggle={() => toggle(section.id)}>
              {section.groups.map((group) => (
                <section key={group.title} className="ir-group">
                  <header><h4>{group.title}</h4>{group.note ? <p className="muted">{group.note}</p> : null}</header>
                  <div className="ir-stack">
                    {group.scripts.map((script, scriptIndex) => (
                      <article key={`${script.title}-${scriptIndex}`} className="ir-script">
                        <header><b>{script.title}</b>{script.context ? <span className="faint">{script.context}</span> : null}</header>
                        <CopyBlock text={script.text} label={`${section.title}: ${group.title}: ${script.title}`} />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </Accordion>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------- cold email subject lines etc. */

function ColdEmailBody({ sections }: { sections: SwipeSection[] }) {
  const { open, toggle } = useOpenSections(sections[0]?.id);
  const total = sections.reduce((sum, section) => sum + section.groups.reduce((n, group) => n + group.items.length, 0), 0);

  return (
    <>
      <Intro eyebrow={`${total} ready-to-use lines`} title="Write cold emails that earn the reply" text="Swipe a subject line, opening hook, and CTA—then personalize the placeholders for each brand." icon={<Send />} />
      <div className="ir-stack">
        {sections.map((section, index) => (
          <Accordion key={section.id} index={index} title={section.title} count={section.countLabel} expanded={open.has(section.id)} onToggle={() => toggle(section.id)}>
            {section.groups.map((group) => (
              <section key={group.title} className="ir-group">
                <header><h4>{group.title}</h4></header>
                <div className="ir-stack">
                  {group.items.map((item, itemIndex) => (
                    <CopyBlock key={`${group.title}-${itemIndex}`} text={item} label={`${section.title}: ${group.title}: item ${itemIndex + 1}`} />
                  ))}
                </div>
              </section>
            ))}
          </Accordion>
        ))}
      </div>
    </>
  );
}

/* ---------------------------------------------------------- agencies & platforms */

type TypeFilter = "any" | "agency" | "platform";
type LevelFilter = "any" | AgencyLevel;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "any", label: "All" },
  { value: "agency", label: "Agency" },
  { value: "platform", label: "Platform" },
];
const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: "any", label: "All" },
  { value: "new", label: "New" },
  { value: "hustle", label: "Hustle" },
  { value: "pro", label: "Pro" },
  { value: "all", label: "All Levels" },
];
const TYPE_LABELS: Record<AgencyType, string> = { agency: "Agency", platform: "Platform", both: "Agency + Platform" };
const LEVEL_LABELS: Record<AgencyLevel, string> = { new: "New Bee 🐣", hustle: "Hustle Bee 💨", pro: "Pro Bee 🐝", all: "All Levels 🍯" };

function AgenciesBody({ entries }: { entries: AgencyEntry[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("any");
  const [level, setLevel] = useState<LevelFilter>("any");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((entry) =>
      (!needle || entry.name.toLocaleLowerCase().includes(needle))
      && (type === "any" || entry.type === type || entry.type === "both")
      && (level === "any" || entry.level === level));
  }, [entries, query, type, level]);

  return (
    <>
      <Intro eyebrow="Creator opportunity directory" title="Find your next paid collaboration" text="Browse agencies and platforms you can collaborate with. Click any card to go straight to their sign-up or application page." />
      <div className="card ir-filters">
        <SearchBar value={query} onChange={setQuery} placeholder="Search by name…" />
        <FilterGroup legend="Type" options={TYPE_FILTERS} value={type} onChange={setType} />
        <FilterGroup legend="Bee level" options={LEVEL_FILTERS} value={level} onChange={setLevel} />
      </div>
      <p className="ir-result muted" aria-live="polite"><b>{filtered.length}</b> {filtered.length === 1 ? "opportunity" : "opportunities"}</p>
      {filtered.length ? (
        <div className="ir-agency-grid">
          {filtered.map((entry) => (
            <button key={`${entry.name}-${entry.signupUrl}`} className="card ir-agency" onClick={() => ch.app.openExternal(entry.signupUrl)} title={entry.signupUrl}>
              <span className="ir-agency-top"><AgencyLogo entry={entry} /><ArrowUpRight className="faint" /></span>
              <span className="ir-agency-body"><b>{entry.name}</b><span className="faint">{entry.domain}</span></span>
              {entry.type || entry.level ? (
                <span className="ir-badges">
                  {entry.type ? <span className="ir-badge type">{TYPE_LABELS[entry.type]}</span> : null}
                  {entry.level ? <span className={`ir-badge level-${entry.level}`}>{LEVEL_LABELS[entry.level]}</span> : null}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="card ir-empty">
          <Search /><b>No matches yet</b><span className="muted">Try clearing a filter or searching another name.</span>
          <button className="btn" onClick={() => { setQuery(""); setType("any"); setLevel("any"); }}>Clear filters</button>
        </div>
      )}
    </>
  );
}

function FilterGroup<T extends string>({ legend, options, value, onChange }: { legend: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="ir-filter">
      <span className="section-label">{legend}</span>
      <div className="chips">
        {options.map((option) => (
          <button key={option.value} className={`chip ${value === option.value ? "on" : ""}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

function monogram(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length > 1) return words.slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Logo.dev, then the favicon service, then a monogram — the web's fallback chain. */
function AgencyLogo({ entry }: { entry: AgencyEntry }) {
  const sources = [entry.logoUrl, entry.faviconUrl].filter((s): s is string => !!s);
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return <span className="ir-logo ir-mono">{monogram(entry.name)}</span>;
  return (
    <span className="ir-logo">
      <img src={sources[index]} alt="" width={40} height={40} loading="lazy" onError={() => setIndex(index + 1)} />
    </span>
  );
}

/* ------------------------------------------------- camera settings manual (iPhone) */

function CameraSettingsBody({ data }: { data: NonNullable<Content["camera-settings-manual-iphone"]> }) {
  const origin = useSiteOrigin();
  const resolve = (src: string) => (/^https?:/.test(src) ? src : origin ? `${origin.replace(/\/$/, "")}${src}` : null);
  const hlsUrl = data.stream.hlsUrl ?? null;

  return (
    <>
      <Section eyebrow="Start here" title="Full settings walkthrough 👇">
        {hlsUrl ? (
          <HlsVideo hlsUrl={hlsUrl} posterUrl={data.stream.posterUrl ?? null} title="Camera Settings Manual full walkthrough" aspect={720 / 1556} />
        ) : (
          <p className="muted">The walkthrough video isn't available right now.</p>
        )}
      </Section>

      <Section eyebrow="iPhone setup" title="Five settings for pro-quality UGC" intro="Work through these once, then leave your camera ready for every shoot.">
        <div className="ir-stack">
          {data.steps.map((step) => {
            const image = step.image ? resolve(step.image.src) : null;
            return (
              <article key={step.number} className="ir-step">
                <div className="ir-step-copy">
                  <span className="ir-step-num">{pad(step.number)}</span>
                  <h4>✅ {step.number}. {step.title}</h4>
                  {step.settingPath ? <p className="ir-setting"><b>Setting Path:</b><span>{step.settingPath}</span></p> : null}
                  {step.setTo ? <p className="ir-setting"><b>Set to:</b><span>{step.setTo}</span></p> : null}
                  <div className="ir-why"><b>Why?</b><p>{step.why}</p></div>
                  {step.number === 5 ? (
                    <div className="ir-tip">
                      <b>Pro Tip:</b>
                      <ul>
                        <li>Use a mirror-style phone case</li>
                        <li>OR add a monitor attachment to see yourself while filming. <button className="link" onClick={() => ch.app.openExternal(data.monitorUrl)}>CLICK HERE</button></li>
                      </ul>
                    </div>
                  ) : null}
                </div>
                {step.image && image ? (
                  <button className="ir-step-img" onClick={() => ch.app.openExternal(image)} title="Open full size">
                    <img src={image} alt={step.image.alt} style={{ aspectRatio: `${step.image.width} / ${step.image.height}` }} loading="lazy" />
                    <span className="faint">Click to enlarge</span>
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </Section>

      <Section eyebrow="Ready to film" title="📝 Next Steps:" intro="Once these settings are in place, your content quality will immediately improve. Don't forget to:">
        <ul className="ir-bullets">{data.nextSteps.map((tip) => <li key={tip}>{tip}</li>)}</ul>
      </Section>
    </>
  );
}
