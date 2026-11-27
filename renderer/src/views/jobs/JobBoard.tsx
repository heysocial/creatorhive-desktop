import { useEffect, useReducer, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Briefcase, Building2, Check, ChevronLeft, ExternalLink, FileText, Lock, Plus, RotateCw, Sparkles, Upload, X } from "lucide-react";
import { api, ApiError, queryClient } from "../../lib/api";
import { ch, type LocalVideoFile } from "../../lib/bridge";
import { ago } from "../../lib/format";
import { nav, useNav } from "../../lib/nav";
import { readClip } from "../../lib/starter";
import {
  AFFILIATE_JOBS_KEY, CAMPAIGN_VIDEO_ACCEPT, CAMPAIGN_VIDEO_EXT, CAMPAIGN_VIDEO_MAX_BYTES, UPLOAD_PARALLEL,
  campaignKey, mineLine, usd, useAffiliateCampaign, useAffiliateJobs, useBrandJobCount, useJobBoardAccess, videoStatus,
  type AffiliateCampaign, type CampaignVideo,
} from "../../lib/jobs";
import { useMeAccess } from "../../lib/access";
import { Modal, Monogram, hubToast } from "../hub/parts";
import "../../styles/starter.css";
import "../../styles/video-edits.css";
import "../../styles/jobs.css";

/*
  The Job board (creatorhive-app docs/affiliate-job-board-v2.md): Affiliates ·
  Brands. Affiliate campaigns have no application step: open one, read its
  script, upload up to 50 videos at once. Each goes to CreatorHive's review,
  then to the affiliate's marketplace. Brands stay on the website for an
  agency's creator; everyone else sees Brands' empty state.
*/

/** "Job board · Coming soon" in the sidebar: the lock, like every other locked row; it opens the Coming soon screen. */
export function JobBoardSoonItem() {
  const { current } = useNav();
  const on = current.ws === "ch" && current.view.kind === "jobs";
  return (
    <button className={`sb-item locked ${on ? "on" : ""}`} aria-label="Job board, coming soon" title="Job board · Coming soon"
      aria-current={on ? "page" : undefined} onClick={() => nav.open({ kind: "jobs" }, "home", "ch")}>
      <Briefcase />
      <span className="label">Job board · Coming soon</span>
      <Lock className="sb-lock" aria-hidden />
    </button>
  );
}

function ComingSoon() {
  return (
    <div className="page">
      <div className="mhead"><h1><Briefcase />Job Board</h1></div>
      <div className="soon-screen">
        <div className="soon-card">
          <div className="soon-icon" aria-hidden><Lock /></div>
          <div className="soon-name">Job Board</div>
          <div className="soon-message">Coming soon</div>
        </div>
      </div>
    </div>
  );
}

function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="card ve-locked-big jb-empty">{icon}<b>{title}</b><span className="muted">{text}</span></div>;
}

/** The product image, else the brand's logo, else the brand's initial. */
function CampaignArt({ campaign, className }: { campaign: AffiliateCampaign; className: string }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : campaign.imageUrl ?? campaign.brand.logoUrl;
  return (
    <span className={`jb-art ${className} ${src && !campaign.imageUrl ? "logo" : ""}`}>
      {src ? <img src={src} alt="" onError={() => setBroken(true)} /> : <Monogram name={campaign.brand.initial || campaign.brand.name} size={44} />}
    </span>
  );
}

function BrandMark({ campaign, size = 20 }: { campaign: AffiliateCampaign; size?: number }) {
  return <Monogram name={campaign.brand.initial || campaign.brand.name} size={size} />;
}

export function JobBoard({ section = "affiliates" }: { section?: "affiliates" | "brands" }) {
  const access = useJobBoardAccess();
  const me = useMeAccess();
  const agency = me.data?.jobBoard === true;
  const affiliates = useAffiliateJobs(access === "native");
  const brands = useBrandJobCount(access !== "none" && access !== "soon" && agency);
  if (access === "soon") return <ComingSoon />;
  if (me.isPending) return <div className="page"><div className="mhead"><h1><Briefcase />Job Board</h1></div><div className="empty-state">Loading…</div></div>;

  const go = (next: "affiliates" | "brands") => nav.open({ kind: "jobs", section: next });
  const campaigns = affiliates.data?.campaigns ?? [];
  const earnings = affiliates.data?.earnings;
  const brandCount = agency ? brands.data : 0;
  return (
    <div className="page">
      <div className="mhead"><h1><Briefcase />Job Board</h1></div>
      <div className="scroll page-body jb-page">
        <div className="jb-top">
          <span className="st-eyebrow">Paid jobs · {section === "brands" ? "Brands" : "Affiliates"}</span>
          <div className="seg" role="tablist" aria-label="Job board">
            <button role="tab" aria-selected={section === "affiliates"} className={section === "affiliates" ? "on" : ""} onClick={() => go("affiliates")}>
              Affiliates{affiliates.data ? ` · ${campaigns.length}` : ""}
            </button>
            <button role="tab" aria-selected={section === "brands"} className={section === "brands" ? "on" : ""} onClick={() => go("brands")}>
              Brands{brandCount != null ? ` · ${brandCount}` : ""}
            </button>
          </div>
        </div>

        {section === "brands" ? (
          agency ? (
            <div className="card ve-locked-big jb-empty">
              <Building2 /><b>Brand jobs open on the website</b>
              <span className="muted">Your agency's brand jobs, invitations and chats are on the CreatorHive website for now.</span>
              <button className="btn honey" onClick={() => ch.app.openSite("/jobs?section=brands")}><ExternalLink />Open brand jobs</button>
            </div>
          ) : (
            <Empty icon={<Building2 />} title="No brand jobs for you yet"
              text="Brand jobs come through a talent agency on CreatorHive. When an agency adds you, its brands' jobs show up here." />
          )
        ) : affiliates.isPending ? (
          <div className="empty-state">Loading…</div>
        ) : affiliates.isError ? (
          <div className="empty-state">
            <div>
              <p>{affiliates.error instanceof ApiError && typeof affiliates.error.data?.error === "string" ? affiliates.error.data.error : "Couldn't load the campaigns."}</p>
              <button className="btn" style={{ marginTop: 10 }} onClick={() => void affiliates.refetch()}><RotateCw />Try again</button>
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <Empty icon={<Sparkles />} title="No affiliate campaigns right now" text="When an affiliate opens a campaign that fits you, it shows up here." />
        ) : (
          <>
            <div className="jb-grid">
              {campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
            </div>
            {earnings && earnings.soldCount > 0 ? (
              <p className="jb-earnings">Your affiliate earnings: <b>{usd(earnings.totalCents)}</b> · {earnings.soldCount} {earnings.soldCount === 1 ? "video" : "videos"} bought</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: AffiliateCampaign }) {
  const mine = mineLine(campaign.mine);
  return (
    <button className="card jb-card" onClick={() => nav.open({ kind: "affiliate-campaign", id: campaign.id })}>
      <CampaignArt campaign={campaign} className="thumb" />
      <span className="jb-card-body">
        <span className="jb-brand"><BrandMark campaign={campaign} /><b>{campaign.brand.name}</b></span>
        <span className="jb-name">{campaign.name}</span>
        <b className="jb-price">{usd(campaign.priceCents)} / video · unlimited videos</b>
        <span className="faint jb-wanted">Wanted: {campaign.wanted?.label || "any creator"}</span>
        {mine ? <span className="muted jb-mine">{mine}</span> : null}
      </span>
    </button>
  );
}

/* ---------- One campaign ---------- */

export function AffiliateCampaignPage({ id }: { id: string }) {
  const { data, isPending, isError, error, refetch } = useAffiliateCampaign(id);
  const access = useJobBoardAccess();
  const [uploading, setUploading] = useState(false);
  const back = () => nav.open({ kind: "jobs", section: "affiliates" });
  const head = (
    <div className="mhead">
      <button className="btn ghost st-back" onClick={back}><ChevronLeft />Job Board</button>
      {data ? <h1>{data.campaign.brand.name}</h1> : null}
    </div>
  );
  if (access === "soon") return <ComingSoon />;
  if (isPending) return <div className="page">{head}<div className="empty-state">Loading…</div></div>;
  if (isError || !data) {
    const message = error instanceof ApiError && typeof error.data?.error === "string" ? error.data.error
      : error instanceof ApiError && error.status === 404 ? "This campaign is closed." : "Couldn't load this campaign.";
    return (
      <div className="page">{head}
        <div className="empty-state"><div><p>{message}</p><button className="btn" style={{ marginTop: 10 }} onClick={() => void refetch()}><RotateCw />Try again</button></div></div>
      </div>
    );
  }
  const { campaign, videos } = data;
  const mine = mineLine(campaign.mine);
  return (
    <div className="page">
      {head}
      <div className="scroll page-body">
        <div className="st-cols jb-detail">
          <div className="jb-main">
            <CampaignArt campaign={campaign} className="hero" />
            <div>
              <h2 className="jb-title">{campaign.brand.name}</h2>
              <p className="muted jb-sub">Affiliate campaign · {campaign.name}</p>
            </div>
            <section className="jb-section">
              <h3 className="jb-label">Script</h3>
              {campaign.script?.trim() ? <div className="card jb-script">{campaign.script}</div>
                : campaign.briefUrl ? <button className="btn" onClick={() => ch.app.openExternal(campaign.briefUrl!)}><FileText />Open the script<ExternalLink /></button>
                : <p className="muted">No script for this one. Film it your way.</p>}
            </section>
            {campaign.audience?.trim() ? (
              <section className="jb-section">
                <h3 className="jb-label">Audience</h3>
                <p className="jb-text">{campaign.audience}</p>
              </section>
            ) : null}
            {videos.length ? (
              <section className="jb-section">
                <h3 className="jb-label">Your videos · {videos.length}</h3>
                <div className="card jb-videos">
                  {videos.map((video) => <VideoRow key={video.id} video={video} priceCents={campaign.priceCents} />)}
                </div>
              </section>
            ) : null}
          </div>
          <aside className="st-side jb-side">
            <div className="card st-side-card">
              <span className="jb-label">Payout</span>
              <b className="jb-pay">{usd(campaign.priceCents)} per video bought</b>
              <p className="muted">Set price. Upload as many videos as you want — the brand can buy several from you every day.</p>
            </div>
            {campaign.wantedChips?.length ? (
              <div className="card st-side-card">
                <span className="jb-label">Creator wanted</span>
                <div className="chips">{campaign.wantedChips.map((chip) => <span key={chip} className="chip">{chip}</span>)}</div>
              </div>
            ) : null}
            <button className="btn honey lg" onClick={() => setUploading(true)}><Upload />Upload videos (up to 50)</button>
            {mine ? <span className="muted jb-mine center">{mine}</span> : null}
          </aside>
        </div>
      </div>
      {uploading ? <UploadDialog campaign={campaign} onClose={() => setUploading(false)} /> : null}
    </div>
  );
}

function VideoRow({ video, priceCents }: { video: CampaignVideo; priceCents: number }) {
  const status = videoStatus(video, priceCents);
  return (
    <div className="jb-video">
      <span className="jb-video-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : null}</span>
      <span className="jb-video-name"><b title={video.fileName}>{video.fileName}</b><small className="faint">Sent {ago(video.sentAt)}</small></span>
      <span className={`stage-pill sm ${status.tone}`} title={status.label}>{status.label}</span>
    </div>
  );
}

/* ---------- Upload videos (A3) ---------- */

type ItemStatus = "ready" | "queued" | "uploading" | "done" | "failed";
interface Item { key: string; info: LocalVideoFile; still: string | null; status: ItemStatus; sent: number; error?: string }

const STOPPED = "The upload stopped. Check your connection and try again.";
let nextKey = 0;

function failureText(error: unknown, fallback: string) {
  if (error instanceof ApiError && typeof error.data?.error === "string" && error.data.error.trim()) return error.data.error;
  return error instanceof Error && error.message && !(error instanceof ApiError) ? error.message : fallback;
}

export function UploadDialog({ campaign, onClose }: { campaign: AffiliateCampaign; onClose: () => void }) {
  const max = queryClient.getQueryData<{ maxBatch?: number }>(AFFILIATE_JOBS_KEY)?.maxBatch ?? 50;
  const items = useRef<Item[]>([]);
  const [, render] = useReducer((n: number) => n + 1, 0);
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const running = useRef(0);
  const closed = useRef(false);
  const started = useRef(false);
  const inFlight = useRef(new Set<string>());

  const patch = (key: string, change: Partial<Item>) => {
    items.current = items.current.map((item) => (item.key === key ? { ...item, ...change } : item));
    render();
  };

  // Every file's bytes, as the main process streams them.
  useEffect(() => ch.files.onPutProgress(({ id, sent }) => {
    if (!inFlight.current.has(id)) return;
    patch(id.slice("aff:".length), { sent });
  }), []);
  // Open the picker straight away, as the button says.
  useEffect(() => { picker.current?.click(); }, []);
  useEffect(() => () => {
    closed.current = true;
    for (const id of inFlight.current) ch.files.cancelPut(id);
  }, []);

  async function add(files: File[]) {
    setNote(null);
    const room = max - items.current.length;
    const skipped: string[] = [];
    const picked: Item[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!CAMPAIGN_VIDEO_EXT.includes(ext)) { skipped.push(`${file.name} isn't an MP4, MOV, M4V or WebM video.`); continue; }
      if (file.size > CAMPAIGN_VIDEO_MAX_BYTES) { skipped.push(`${file.name} is over 2 GB.`); continue; }
      if (picked.length >= room) { skipped.push(`Up to ${max} videos at once. The rest weren't added.`); break; }
      const info = await ch.files.videoInfo(file);
      if (!info) { skipped.push(`${file.name} couldn't be read.`); continue; }
      if (items.current.some((item) => item.info.path === info.path)) continue;
      picked.push({ key: String(++nextKey), info, still: null, status: "ready", sent: 0 });
    }
    items.current = [...items.current, ...picked];
    render();
    if (skipped.length) setNote([...new Set(skipped)].slice(0, 3).join(" "));
    // Each video's still, a few at a time.
    const byKey = new Map(picked.map((item, i) => [item.key, files.find((f) => f.name === item.info.name) ?? files[i]]));
    for (const item of picked) {
      const file = byKey.get(item.key);
      if (!file || closed.current) continue;
      const { still } = await readClip(file);
      if (still) patch(item.key, { still });
    }
  }

  function remove(key: string) {
    items.current = items.current.filter((item) => item.key !== key);
    render();
  }

  async function send(item: Item) {
    const base = `/api/jobs/affiliates/${encodeURIComponent(campaign.id)}`;
    const putId = `aff:${item.key}`;
    try {
      const { ticket } = await api<{ ticket: { key: string; uploadUrl: string; contentType: string } }>(`${base}/video/upload`, {
        method: "POST", body: { fileName: item.info.name, sizeBytes: item.info.size },
      });
      if (closed.current) return;
      inFlight.current.add(putId);
      const put = await ch.files.putFile({ id: putId, url: ticket.uploadUrl, type: ticket.contentType, filePath: item.info.path });
      inFlight.current.delete(putId);
      if (closed.current) return;
      if (!put.ok) throw new Error(put.error === "no_file" ? "This file was moved or deleted. Choose it again." : STOPPED);
      patch(item.key, { sent: item.info.size });
      await api(`${base}/video`, { method: "PUT", body: { key: ticket.key, fileName: item.info.name } });
      if (!closed.current) patch(item.key, { status: "done", sent: item.info.size });
    } catch (error) {
      inFlight.current.delete(putId);
      if (!closed.current) patch(item.key, { status: "failed", sent: 0, error: failureText(error, "This video couldn't be uploaded. Try again.") });
    }
  }

  function pump() {
    while (running.current < UPLOAD_PARALLEL && !closed.current) {
      const next = items.current.find((item) => item.status === "queued");
      if (!next) break;
      running.current += 1;
      patch(next.key, { status: "uploading", sent: 0, error: undefined });
      void send(next).finally(() => {
        running.current -= 1;
        pump();
        if (running.current === 0 && !closed.current && !items.current.some((item) => item.status === "queued" || item.status === "uploading")) finished();
      });
    }
  }

  function finished() {
    void queryClient.invalidateQueries({ queryKey: campaignKey(campaign.id) });
    void queryClient.invalidateQueries({ queryKey: AFFILIATE_JOBS_KEY });
    const done = items.current.filter((item) => item.status === "done").length;
    if (items.current.every((item) => item.status === "done")) {
      hubToast(`${done} ${done === 1 ? "video" : "videos"} sent for review`);
      onClose();
    } else {
      render();
    }
  }

  function start(keys?: string[]) {
    started.current = true;
    items.current = items.current.map((item) => ((keys ? keys.includes(item.key) : item.status === "ready" || item.status === "failed") ? { ...item, status: "queued" as const, error: undefined } : item));
    render();
    pump();
  }

  const list = items.current;
  const busy = list.some((item) => item.status === "queued" || item.status === "uploading");
  const failed = list.filter((item) => item.status === "failed");
  const done = list.filter((item) => item.status === "done").length;
  const toSend = list.filter((item) => item.status === "ready" || item.status === "failed").length;
  const totalBytes = list.reduce((sum, item) => sum + item.info.size, 0) || 1;
  const sentBytes = list.reduce((sum, item) => sum + (item.status === "done" ? item.info.size : item.status === "uploading" ? item.sent : 0), 0);
  const pct = Math.min(100, Math.round((sentBytes / totalBytes) * 100));

  function close() {
    if (busy && !window.confirm("Stop uploading?\n\nVideos already sent stay sent.")) return;
    if (done) {
      void queryClient.invalidateQueries({ queryKey: campaignKey(campaign.id) });
      void queryClient.invalidateQueries({ queryKey: AFFILIATE_JOBS_KEY });
    }
    onClose();
  }

  const dropProps = busy ? {} : {
    onDragOver: (event: DragEvent) => { event.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => { event.preventDefault(); setOver(false); void add([...event.dataTransfer.files]); },
  };

  const foot = (
    <div className="jb-up-foot">
      {busy ? (
        <span className="st-progress jb-up-progress" role="status">
          <span>Uploading {Math.min(list.length, done + 1)} of {list.length} · {pct}%</span>
          <span className="st-bar"><i style={{ width: `${pct}%` }} /></span>
        </span>
      ) : started.current && failed.length ? (
        <span className="muted jb-up-progress">{done} sent for review · {failed.length} didn't upload</span>
      ) : <span className="jb-up-progress" />}
      <button className="btn" onClick={close}>{busy ? "Stop" : "Cancel"}</button>
      <button className="btn honey" disabled={busy || toSend === 0} onClick={() => start()}>
        <Upload />{busy ? "Uploading…" : failed.length && started.current ? `Retry ${failed.length} ${failed.length === 1 ? "video" : "videos"}` : `Upload ${toSend} ${toSend === 1 ? "video" : "videos"}`}
      </button>
    </div>
  );

  return (
    <Modal title={`Upload videos to ${campaign.brand.name}`} onClose={close} width={640} foot={foot}>
      <div className={`jb-up ${over ? "over" : ""}`} {...dropProps}>
        <input ref={picker} type="file" multiple accept={CAMPAIGN_VIDEO_ACCEPT} hidden
          onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void add(files); }} />
        {list.length === 0 ? (
          <button className="mc-drop" onClick={() => picker.current?.click()}>
            <span className="st-drop-ico"><Plus /></span>
            <b>Choose up to {max} videos</b>
            <span className="faint">or drag them here · MP4, MOV, M4V or WebM</span>
          </button>
        ) : (
          <>
            <b className="jb-up-count">{list.length} of {max} videos selected</b>
            <div className="mc-grid jb-up-grid">
              {list.map((item) => <Tile key={item.key} item={item} busy={busy} onRemove={() => remove(item.key)} onRetry={() => start([item.key])} />)}
              {!busy && list.length < max ? <button className="mc-tile mc-add" onClick={() => picker.current?.click()}><Plus /><span>Add more</span></button> : null}
            </div>
          </>
        )}
        {note ? <span className="st-error">{note}</span> : null}
        {failed.length && !busy ? (
          <ul className="jb-up-failed" role="alert">
            {failed.map((item) => (
              <li key={item.key}><b>{item.info.name}</b><span>{item.error}</span><button className="btn" onClick={() => start([item.key])}><RotateCw />Retry</button></li>
            ))}
          </ul>
        ) : null}
        <p className="muted jb-up-note">{usd(campaign.priceCents)} for each video the brand buys. CreatorHive reviews every video first, then it goes to the brand's marketplace.</p>
      </div>
    </Modal>
  );
}

function Tile({ item, busy, onRemove, onRetry }: { item: Item; busy: boolean; onRemove: () => void; onRetry: () => void }) {
  const pct = item.info.size ? Math.min(100, Math.round((item.sent / item.info.size) * 100)) : 0;
  const up = item.status === "queued" || item.status === "uploading";
  return (
    <div className={`mc-tile ${up || item.status === "failed" ? "up" : ""} ${item.status === "failed" ? "failed" : ""}`} title={item.error ?? item.info.name}>
      {item.still ? <img src={item.still} alt="" /> : null}
      {item.status === "uploading" ? <span className="mc-mid"><b>{pct}%</b></span> : null}
      {item.status === "queued" ? <span className="mc-mid"><span>Waiting…</span></span> : null}
      {item.status === "done" ? <span className="mc-mid"><Check /><span>Sent</span></span> : null}
      {item.status === "failed" && !busy ? <button className="mc-mid mc-retry" onClick={onRetry}><RotateCw /><span>Retry</span></button> : null}
      {up ? <span className="mc-bar"><i style={{ width: `${pct}%` }} /></span> : null}
      {!busy && item.status !== "done" ? <button className="mc-x" aria-label={`Remove ${item.info.name}`} title="Remove" onClick={onRemove}><X /></button> : null}
    </div>
  );
}
