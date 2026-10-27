import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ChevronRight, Download, FileText, Image as ImageIcon, Loader2, MessageCircle, MoreHorizontal, Pin, SquarePen, Wallet, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch, type SessionUser } from "../../lib/bridge";
import { api, queryClient, rateLimitMessage } from "../../lib/api";
import {
  CATEGORIES, POST_REACTIONS, addComment, attachmentName, categoryOf, createPost, deleteComment, editComment, editPost, isImageUrl, likeComment, patchPost,
  reactToPost, splitPostBody, useComments, useFeed, usePinnedPosts, usePost, useUnreadCategories, vote,
  type CategoryKey, type Comment, type Post,
} from "../../lib/feed";
import { ago, money } from "../../lib/format";
import { RichText } from "../../lib/html";
import { nav } from "../../lib/nav";
import { Avatar } from "../../lib/ui";
import { Badge } from "../messages/MessageRow";
import { TodayPanel } from "./Today";
import { PostEditor } from "./PostEditor";
import { Modal, Monogram } from "../hub/parts";
import { pastedFiles } from "../../lib/paste";
import { ReportDialog, type ReportTarget } from "../../overlays/Report";

/* ---------- Paid this month ---------- */

export interface GlanceDeal {
  id: string;
  brandName: string;
  amountUsd: number;
  statusLabel: string;
  paymentExpectedAt: string | null;
  paymentTermsDays: number | null;
  daysOverdue?: number;
}

export interface Glance {
  show: boolean;
  month: { key: string; label: string };
  paid: { amountUsd: number; count: number };
  expectedThisMonthUsd: number;
  pendingThisMonth: { amountUsd: number; deals: GlanceDeal[] };
  futureMonths: { amountUsd: number; months: { key: string; label: string; amountUsd: number; deals: GlanceDeal[] }[] };
  pastDue: { amountUsd: number; deals: GlanceDeal[] };
  noDate: { amountUsd: number; deals: GlanceDeal[] };
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function useGlance() {
  return useQuery({
    queryKey: ["hub", "glance"],
    queryFn: async () => (await api<{ glance: Glance }>(`/api/hub/glance?tz=${encodeURIComponent(tz())}`)).glance,
  });
}

const shortDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function PaidCard() {
  const { data: glance } = useGlance();
  const [open, setOpen] = useState(false);
  if (!glance?.show) return null;
  const pct = glance.expectedThisMonthUsd > 0 ? Math.min(100, Math.round((glance.paid.amountUsd / glance.expectedThisMonthUsd) * 100)) : 0;
  const total = Math.max(glance.expectedThisMonthUsd + glance.pastDue.amountUsd, 1);
  const paidW = (glance.paid.amountUsd / total) * 100;
  const lateW = (glance.pastDue.amountUsd / total) * 100;
  const firstLate = glance.pastDue.deals[0];
  return (
    <div className="card paid-card">
      <div className="paid-top">
        <span className="paid-ico"><Wallet /></span>
        <button className="paid-fig" onClick={() => nav.section("hub", "ch")} title="Open your Hub">
          <span className="eyebrow">Paid this month</span>
          <span><b>{money(glance.paid.amountUsd)}</b> <span className="muted">of {money(glance.expectedThisMonthUsd)} expected</span></span>
        </button>
        <span className="pct">{pct}%</span>
        <button className="btn" onClick={() => setOpen(true)}>Breakdown<ChevronRight /></button>
        <button className="btn honey" onClick={() => nav.section("hub", "ch")}>Open Hub</button>
      </div>
      <div className="paid-bar"><i className="paid" style={{ width: `${paidW}%` }} /><i className="late" style={{ width: `${lateW}%` }} /></div>
      <div className="paid-legend">
        <span><i className="dot paid" />Paid {money(glance.paid.amountUsd)}</span>
        {glance.pastDue.amountUsd > 0 ? <span><i className="dot late" />Overdue {money(glance.pastDue.amountUsd)}{firstLate ? ` · ${firstLate.brandName}${glance.pastDue.deals.length > 1 ? ` +${glance.pastDue.deals.length - 1}` : ""}` : ""}</span> : null}
        <span><i className="dot rest" />Still to come {money(glance.pendingThisMonth.amountUsd)}</span>
      </div>
      {open ? <Breakdown glance={glance} pct={pct} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function Breakdown({ glance, pct, onClose }: { glance: Glance; pct: number; onClose: () => void }) {
  const row = (deal: GlanceDeal, detail: string, late = false) => (
    <li key={deal.id}>
      <button className="glance-row" onClick={() => { onClose(); nav.open({ kind: "hub", page: "deals", dealId: deal.id }, "hub", "ch"); }}>
        <Monogram name={deal.brandName} size={28} />
        <span className="gr-text"><b>{deal.brandName}</b><small className={late ? "late-text" : ""}>{detail}</small></span>
        <span className="amt">{money(deal.amountUsd)}</span>
        {late ? <span className="btn">Follow up</span> : null}
      </button>
    </li>
  );
  return (
    <Modal title={`${glance.month.label} payments`} onClose={onClose} width={520}>
      <div className="glance">
        <section>
          <div className="section-label">Paid so far</div>
          <div className="big">{money(glance.paid.amountUsd)}</div>
          <div className="muted">{pct}% of {money(glance.expectedThisMonthUsd)} expected this month</div>
          <div className="paid-bar" style={{ marginTop: 8 }}><i className="paid" style={{ width: `${pct}%` }} /></div>
        </section>
        <section>
          <div className="section-label">Pending this month · {money(glance.pendingThisMonth.amountUsd)}</div>
          {glance.pendingThisMonth.deals.length ? <ul className="glance-list">{glance.pendingThisMonth.deals.map((d) => row(d, `${d.statusLabel} · due ${shortDate(d.paymentExpectedAt!)}`))}</ul> : <p className="muted">Nothing else expected this month.</p>}
        </section>
        <section>
          <div className="section-label">Future months · {money(glance.futureMonths.amountUsd)}</div>
          {glance.futureMonths.months.length ? <ul className="glance-list">{glance.futureMonths.months.flatMap((m) => m.deals.map((d) => row(d, `${m.label} · due ${shortDate(d.paymentExpectedAt!)}${d.paymentTermsDays ? ` · net-${d.paymentTermsDays}` : ""}`)))}</ul> : <p className="muted">Nothing expected after this month yet.</p>}
        </section>
        {glance.pastDue.deals.length ? (
          <section>
            <div className="section-label late-text">Past due · {money(glance.pastDue.amountUsd)}</div>
            <ul className="glance-list">{glance.pastDue.deals.map((d) => row(d, `${d.daysOverdue} ${d.daysOverdue === 1 ? "day" : "days"} overdue · was due ${shortDate(d.paymentExpectedAt!)}`, true))}</ul>
          </section>
        ) : null}
        {glance.noDate.deals.length ? (
          <section>
            <div className="section-label">No payment date yet · {money(glance.noDate.amountUsd)}</div>
            <ul className="glance-list">{glance.noDate.deals.map((d) => row(d, d.statusLabel))}</ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

/* ---------- Writing a post ---------- */

function NewPost({ user, open, draft, onOpen, onClose }: { user: SessionUser; open: boolean; draft: { category: CategoryKey; text: string } | null; onOpen: () => void; onClose: () => void }) {
  const staff = user.role === "owner" || user.role === "team";
  const [text, setText] = useState(draft?.text ?? "");
  const [category, setCategory] = useState<CategoryKey>(draft?.category ?? "general");
  const [media, setMedia] = useState<{ url: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [poll, setPoll] = useState<{ question: string; options: string[] } | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  async function addImages(files: File[]) {
    const images = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type)).slice(0, 4 - media.length);
    if (images.length < files.length) setError("Posts take up to 4 pictures (JPEG, PNG, WebP or GIF).");
    onOpen();
    setUploading((n) => n + images.length);
    for (const file of images) {
      const result = await ch.files.upload({ route: "/api/upload", name: file.name, type: file.type, bytes: await file.arrayBuffer() });
      setUploading((n) => n - 1);
      if (result.ok) setMedia((m) => [...m, { url: result.url, preview: URL.createObjectURL(file) }]);
      else setError((result.error === "rate_limited" && result.message) || "A picture couldn't be uploaded.");
    }
  }

  async function post() {
    if (posting || uploading) return;
    const validPoll = poll && poll.question.trim() && poll.options.filter((o) => o.trim()).length >= 2
      ? { question: poll.question.trim(), options: poll.options.map((o) => o.trim()).filter(Boolean) } : null;
    if (!text.trim() && media.length === 0) return;
    setPosting(true);
    setError(null);
    try {
      await createPost({ text, category, mediaUrls: media.map((m) => m.url), poll: validPoll });
      setText("");
      setMedia([]);
      setPoll(null);
      onClose();
    } catch (error) {
      setError(rateLimitMessage(error) ?? "Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  }

  if (!open) {
    return (
      <div className="card new-post-trigger" onClick={onOpen}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void addImages([...e.dataTransfer.files]); }}>
        <Avatar name={user.name} src={user.image} seed={user.id} size={36} />
        <span className="ph">Drop something worth talking about…</span>
        <button className="iconbtn" title="Add pictures" onClick={(e) => { e.stopPropagation(); picker.current?.click(); }}><ImageIcon /></button>
        <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
    );
  }

  return (
    <div className="card new-post" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void addImages([...e.dataTransfer.files]); }}>
      <div className="np-head">
        <Avatar name={user.name} src={user.image} seed={user.id} size={36} />
        <div className="seg">
          {CATEGORIES.filter((c) => staff || !c.staffOnly).map((c) => (
            <button key={c.key} className={category === c.key ? "on" : ""} onClick={() => setCategory(c.key)}><span>{c.emoji}</span>{c.label}</button>
          ))}
        </div>
        <button className="iconbtn" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} placeholder="Share a win, ask a question, or say hi…" rows={4}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void post(); } if (e.key === "Escape") onClose(); }}
        onPaste={(e) => { void pastedFiles(e).then((files) => files && addImages(files)); }} />
      {media.length || uploading ? (
        <div className="np-media">
          {media.map((m) => <span key={m.url}><img src={m.preview} alt="" /><button onClick={() => setMedia((all) => all.filter((x) => x.url !== m.url))} aria-label="Remove"><X /></button></span>)}
          {Array.from({ length: uploading }, (_, i) => <span key={`u${i}`} className="uploading"><Loader2 className="spin" /></span>)}
        </div>
      ) : null}
      {poll ? (
        <div className="np-poll">
          <input className="field" placeholder="Ask a question" value={poll.question} maxLength={160} onChange={(e) => setPoll({ ...poll, question: e.target.value })} />
          {poll.options.map((option, i) => (
            <input key={i} className="field" placeholder={`Option ${i + 1}`} value={option} maxLength={80}
              onChange={(e) => setPoll({ ...poll, options: poll.options.map((o, j) => (j === i ? e.target.value : o)) })} />
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            {poll.options.length < 4 ? <button className="btn" onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })}>Add option</button> : null}
            <button className="btn" onClick={() => setPoll(null)}>Remove poll</button>
          </div>
        </div>
      ) : null}
      {error ? <div className="signin-error">{error}</div> : null}
      <div className="np-foot">
        <button className="iconbtn" title="Add pictures" onClick={() => picker.current?.click()}><ImageIcon /></button>
        {!poll ? <button className="btn" onClick={() => setPoll({ question: "", options: ["", ""] })}>Add a poll</button> : null}
        <span className="faint" style={{ marginLeft: "auto", fontSize: 12 }}>⌘↩ to post</span>
        <button className="btn honey" disabled={posting || uploading > 0 || (!text.trim() && media.length === 0)} onClick={() => void post()}>
          {posting ? <Loader2 className="spin" /> : null}Post
        </button>
      </div>
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </div>
  );
}

/* ---------- A post ---------- */

function PollView({ post }: { post: Post }) {
  const poll = post.poll!;
  const voted = Boolean(poll.myVote);
  return (
    <div className="poll">
      <b>{poll.question}</b>
      {poll.options.map((option) => {
        const pct = poll.totalVotes ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        return (
          <button key={option.id} className={`poll-opt ${poll.myVote === option.id ? "mine" : ""}`} onClick={() => void vote(post, option.id)}>
            {voted ? <i style={{ width: `${pct}%` }} /> : null}
            <span>{option.label}</span>{voted ? <span className="pct">{pct}%</span> : null}
          </button>
        );
      })}
      <span className="faint">{poll.totalVotes === 1 ? "1 vote" : `${poll.totalVotes} votes`}</span>
    </div>
  );
}

/** The body, with its first line as a title when more follows (splitPostBody). */
function PostBody({ html }: { html: string }) {
  const { title, body } = useMemo(() => splitPostBody(html), [html]);
  return (
    <div className="post-text">
      {title ? <RichText html={title} className="rich post-title" /> : null}
      <RichText html={body} className="rich post-body" />
    </div>
  );
}

/*
  A post's pictures and files, laid out as the website's feed does
  (components/feed/FeedAttachments.tsx there). Every picture fills a frame of
  fixed shape: one sits in a 340 × 190 frame, several share a two-column grid
  of squares. The picture is cropped to its frame (object-fit: cover), so there
  is never a frame wider than its picture, which is how a GIF used to get an
  empty grey box beside it. Anything that isn't a picture (a video, a PDF) is a
  file row, as on the website.
*/
function PostMedia({ urls }: { urls: string[] }) {
  const images = urls.filter(isImageUrl);
  const files = urls.filter((url) => !isImageUrl(url));
  const menu = async (event: MouseEvent, url: string, name: string, image: boolean) => {
    event.preventDefault();
    const choice = await ch.menu.popup([
      { id: "look", label: "Quick Look" },
      { id: "save", label: "Save to Downloads…" },
      ...(image ? [{ id: "copy", label: "Copy image address" }] : []),
    ]);
    if (choice === "look") void ch.files.quickLook(url, name);
    if (choice === "save") void ch.files.save(url, name);
    if (choice === "copy") void navigator.clipboard.writeText(url);
  };
  return (
    <>
      {images.length ? (
        <div className={`post-imgs ${images.length > 1 ? "multi" : "one"}`}>
          {images.map((url) => {
            const name = attachmentName(url);
            return (
              <button key={url} className="post-img" title="Click to preview (Quick Look)" onClick={() => void ch.files.quickLook(url, name)} onContextMenu={(e) => void menu(e, url, name, true)}>
                <img src={url} alt="Post attachment" loading="lazy" decoding="async" draggable={false} />
              </button>
            );
          })}
        </div>
      ) : null}
      {files.length ? (
        <div className="post-files">
          {files.map((url) => {
            const name = attachmentName(url);
            return (
              <button key={url} className="post-file" title="Click to preview (Quick Look)" onClick={() => void ch.files.quickLook(url, name)} onContextMenu={(e) => void menu(e, url, name, false)}>
                <span><FileText /></span><b>{name}</b><Download />
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

export function PostCard({ post, user, onOpen }: { post: Post; user: SessionUser; onOpen: (post: Post) => void }) {
  const category = categoryOf(post.filterTag);
  const own = post.author.id === user.id;
  const staff = user.role === "owner" || user.role === "team";
  // Never your own: reporting yourself is noise for the team's queue, as on the website.
  const canReport = !own && post.author.role !== "system";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  async function saveEdit(html: string | null, empty: boolean) {
    if (saving) return;
    // Nothing changed: close without stamping "edited" on it.
    if (html === null) { setEditing(false); return; }
    if (empty && post.mediaUrls.length === 0 && !post.poll) { setEditError("A post needs some words, a photo or a poll."); return; }
    setSaving(true);
    setEditError(null);
    try {
      await editPost(post, html);
      setEditing(false);
    } catch {
      setEditError("Couldn’t save your edit. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function more() {
    const choice = await ch.menu.popup([
      { id: "comments", label: "Open comments" },
      { id: "copy", label: "Copy link" },
      { id: "share", label: "Share…" },
      ...(staff ? [{ id: "pin", label: post.pinned ? "Unpin post" : "Pin post" }] : []),
      // Only the author edits: a moderator can remove a post but not rewrite it.
      ...(own || staff || canReport ? [{ type: "separator" as const }] : []),
      ...(own ? [{ id: "edit", label: "Edit post" }] : []),
      ...(own || staff ? [{ id: "delete", label: "Delete post…" }] : []),
      ...(canReport ? [{ id: "report", label: "Report post…" }] : []),
    ]);
    if (choice === "edit") { setEditError(null); setEditing(true); }
    if (choice === "report") setReporting(true);
    if (choice === "comments") onOpen(post);
    if (choice === "copy") void navigator.clipboard.writeText(`${(await ch.info()).origin}/?post=${post.id}`);
    if (choice === "share") ch.app.share(`${(await ch.info()).origin}/?post=${post.id}`, `${post.author.name} on CreatorHive`);
    if (choice === "pin") {
      try {
        await api(`/api/feed-v2/posts/${post.id}/pin`, { method: "POST", body: { pinned: !post.pinned } });
      } catch {
        window.alert("Could not update the pin. Please try again.");
      }
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
    }
    if (choice === "delete" && window.confirm("Delete this post?\n\nThis removes the post and its comments for everyone.")) {
      try {
        await api(`/api/posts/${post.id}`, { method: "DELETE" });
        patchPost(post.id, () => null);
      } catch {
        window.alert("Couldn't delete the post.");
      }
    }
  }

  return (
    <article className={`card post ${post.pinned ? "pinned" : ""}`}>
      <header>
        <button onClick={() => nav.open({ kind: "profile", id: post.author.id })}><Avatar name={post.author.name} src={post.author.avatarUrl} seed={post.author.id} size={38} /></button>
        <div className="by">
          <span><button className="name" onClick={() => nav.open({ kind: "profile", id: post.author.id })}>{post.author.name}</button><Badge badge={post.author.badge} role={post.author.role} /></span>
          <span className="faint">{ago(post.createdAt)}{post.editedAt ? " · edited" : ""}</span>
        </div>
        <div className="tags">
          {post.pinned ? <span className="tag pin"><Pin />Pinned</span> : null}
          {category ? <span className="tag">{category.emoji} {category.label === "Intros" ? "Intro" : category.label.replace(/s$/, "")}</span> : null}
          <button className="iconbtn" onClick={() => void more()} aria-label="More"><MoreHorizontal /></button>
        </div>
      </header>
      {editing ? (
        <PostEditor html={post.body} saving={saving} error={editError} onSave={(html, empty) => void saveEdit(html, empty)} onCancel={() => setEditing(false)} />
      ) : <PostBody html={post.body} />}
      {post.mediaUrls.length ? <PostMedia urls={post.mediaUrls} /> : null}
      {post.poll ? <PollView post={post} /> : null}
      <footer>
        <div className="reacts">
          {POST_REACTIONS.map((emoji) => {
            const r = post.reactions[emoji];
            return (
              <button key={emoji} className={`react ${r?.mine ? "mine" : ""} ${r?.count ? "" : "ghost"}`} onClick={() => void reactToPost(post, emoji)}>
                <span>{emoji}</span>{r?.count ? r.count : null}
              </button>
            );
          })}
        </div>
        <button className="comments-btn" onClick={() => onOpen(post)}>
          <MessageCircle />{post.commentsCount ? (post.commentsCount === 1 ? "1 comment" : `${post.commentsCount} comments`) : "Comment"}
        </button>
      </footer>
      {reporting ? <ReportDialog target={{ type: "post", id: post.id, name: post.author.name }} onClose={() => setReporting(false)} /> : null}
    </article>
  );
}

/* ---------- Comments ---------- */

interface CommentActions {
  onReply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;
}

function CommentRow({ comment, postId, editing, actions, onSaveEdit, onCancelEdit }: {
  comment: Comment;
  postId: string;
  editing: boolean;
  actions: CommentActions;
  onSaveEdit: (body: string) => Promise<boolean>;
  onCancelEdit: () => void;
}) {
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (editing) setDraft(comment.body); }, [editing, comment.body]);

  async function save() {
    if (saving || !draft.trim()) return;
    setSaving(true);
    try { if (await onSaveEdit(draft.trim())) onCancelEdit(); } finally { setSaving(false); }
  }

  // The same actions on a right-click, as messages have.
  async function menu() {
    const choice = await ch.menu.popup([
      { id: "copy", label: "Copy text" },
      { id: "reply", label: "Reply" },
      ...(actions.onEdit || actions.onDelete || actions.onReport ? [{ type: "separator" as const }] : []),
      ...(actions.onEdit ? [{ id: "edit", label: "Edit comment" }] : []),
      ...(actions.onDelete ? [{ id: "delete", label: "Delete comment…" }] : []),
      ...(actions.onReport ? [{ id: "report", label: "Report comment…" }] : []),
    ]);
    if (choice === "copy") void navigator.clipboard.writeText(comment.body);
    if (choice === "reply") actions.onReply();
    if (choice === "edit") actions.onEdit?.();
    if (choice === "delete") actions.onDelete?.();
    if (choice === "report") actions.onReport?.();
  }

  return (
    <div className={`comment ${comment.parentCommentId ? "reply" : ""}`}
      onContextMenu={(event) => {
        if (comment.deleted || editing || (event.target as HTMLElement).closest("button, a, textarea")) return;
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void menu();
      }}>
      <Avatar name={comment.author.name} src={comment.author.avatarUrl} seed={comment.author.id} size={30} />
      <div>
        {editing ? (
          <div className="inline-edit">
            <textarea autoFocus value={draft} maxLength={2000} disabled={saving} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancelEdit(); }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); }
              }} />
            <div className="hint">Escape to cancel · Return to save
              <button className="btn" disabled={saving} onClick={onCancelEdit}>Cancel</button>
              <button className="btn honey" disabled={saving || !draft.trim()} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : null}Save</button>
            </div>
          </div>
        ) : (
          <div className="bubble">
            <span className="who"><b>{comment.author.name}</b><Badge badge={comment.author.badge} role={comment.author.role} /></span>
            <div className="selectable" style={{ whiteSpace: "pre-wrap" }}>{comment.deleted ? <i className="faint">Comment deleted</i> : comment.body}</div>
          </div>
        )}
        {!comment.deleted && !editing ? (
          <div className="c-meta">
            <span>{ago(comment.createdAt)}{comment.editedAt ? " · edited" : ""}</span>
            <button className={comment.likedByMe ? "on" : ""} onClick={() => void likeComment(postId, comment)}>Like{comment.likeCount ? ` · ${comment.likeCount}` : ""}</button>
            <button onClick={actions.onReply}>Reply</button>
            {actions.onEdit ? <button onClick={actions.onEdit}>Edit</button> : null}
            {actions.onDelete ? <button onClick={actions.onDelete}>Delete</button> : null}
            {actions.onReport ? <button onClick={actions.onReport}>Report</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Each top-level comment followed by every reply under it (replies to replies
 * included), oldest first, as the website groups them. A reply whose parent
 * isn't in the list stands on its own.
 */
function groupComments(list: Comment[]) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const rootOf = (comment: Comment) => {
    let current = comment;
    const seen = new Set<string>();
    while (current.parentCommentId && byId.has(current.parentCommentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentCommentId)!;
    }
    return current.id;
  };
  const roots = list.filter((c) => rootOf(c) === c.id);
  return roots.map((comment) => ({ comment, replies: list.filter((r) => r.id !== comment.id && rootOf(r) === comment.id) }));
}

export function PostSheet({ postId, user, onClose }: { postId: string; user: SessionUser; onClose: () => void }) {
  const post = usePost(postId);
  const comments = useComments(postId);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const staff = user.role === "owner" || user.role === "team";
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".emoji-pop, .scrim.center") && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const threads = useMemo(() => groupComments(comments.data ?? []), [comments.data]);

  // The website's rules: anyone replies, the author edits, the author or a moderator deletes, anyone else reports.
  function actionsFor(comment: Comment): CommentActions {
    const mine = comment.author.id === user.id;
    return {
      onReply: () => {
        setReplyTo(comment);
        // A reply to a reply names who it answers, as on the website.
        if (comment.parentCommentId) setText((current) => current.trim() ? current : `@${comment.author.name} `);
        box.current?.focus();
      },
      onEdit: mine ? () => setEditingId(comment.id) : undefined,
      onDelete: mine || staff ? () => void remove(comment) : undefined,
      onReport: !mine && comment.author.role !== "system" ? () => setReporting({ type: "comment", id: comment.id, name: comment.author.name }) : undefined,
    };
  }

  async function remove(comment: Comment) {
    const mine = comment.author.id === user.id;
    const hasReplies = (comments.data ?? []).some((c) => c.parentCommentId === comment.id);
    const detail = hasReplies ? "It will show as “Comment deleted”. The replies to it stay."
      : mine ? "This removes your comment for everyone." : `This removes ${comment.author.name || "this member"}’s comment for everyone.`;
    if (!window.confirm(`Delete this comment?\n\n${detail}`)) return;
    try {
      await deleteComment(postId, comment);
      if (replyTo?.id === comment.id) setReplyTo(null);
    } catch {
      window.alert("Couldn’t delete that comment. Try again.");
    }
  }

  async function saveEdit(comment: Comment, body: string) {
    if (body === comment.body) return true;
    try {
      await editComment(postId, comment, body);
      return true;
    } catch {
      window.alert("Couldn’t save your edit. Try again.");
      return false;
    }
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await addComment(postId, text.trim(), replyTo?.id ?? null);
      setText("");
      setReplyTo(null);
    } catch (error) {
      window.alert(rateLimitMessage(error) ?? "Couldn't add the comment.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="scrim side" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="side-sheet wide" role="dialog" aria-label="Post">
        <div className="sheet-head">Post<button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="side-body scroll">
          {post.data ? <PostCard post={post.data} user={user} onOpen={() => box.current?.focus()} /> : post.isError ? <div className="err-state">This post isn't available.</div> : <div className="msgs-skel"><div /><div /></div>}
          <div className="comments">
            {comments.isLoading ? <div className="faint">Loading comments…</div> : null}
            {threads.map(({ comment, replies }) => (
              <div key={comment.id}>
                {[comment, ...replies].map((c) => (
                  <CommentRow key={c.id} comment={c} postId={postId} editing={editingId === c.id} actions={actionsFor(c)}
                    onSaveEdit={(body) => saveEdit(c, body)} onCancelEdit={() => setEditingId(null)} />
                ))}
              </div>
            ))}
            {comments.data?.length === 0 ? <div className="faint">No comments yet. Start the conversation.</div> : null}
          </div>
        </div>
        <div className="comment-box">
          {replyTo ? <div className="replying"><span>Replying to <b>{replyTo.author.name}</b></span><button className="iconbtn" onClick={() => setReplyTo(null)}><X /></button></div> : null}
          <div className="composer compact" style={{ margin: 0 }}>
            <textarea ref={box} rows={1} value={text} maxLength={2000} placeholder="Write a comment…" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <div className="tools"><button className={`send ${text.trim() ? "on" : ""}`} disabled={!text.trim() || sending} onClick={() => void send()}>{sending ? <Loader2 className="spin" /> : <SquarePen />}</button></div>
          </div>
        </div>
      </aside>
      {reporting ? <ReportDialog target={reporting} onClose={() => setReporting(null)} /> : null}
    </div>
  );
}

/* ---------- Home ---------- */

export function Home({ user, openPostId }: { user: SessionUser; openPostId?: string | null }) {
  const [filter, setFilter] = useState<string>("all");
  const [writing, setWriting] = useState(false);
  const [openPost, setOpenPost] = useState<string | null>(openPostId ?? null);
  const feed = useFeed(filter);
  const pinned = usePinnedPosts();
  const unread = useUnreadCategories().data ?? {};
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => setOpenPost(openPostId ?? null), [openPostId]);

  useEffect(() => {
    if (filter === "all") return;
    void api("/api/posts/unread", { method: "POST", body: { category: filter } }).then(() => queryClient.invalidateQueries({ queryKey: ["posts-unread"] })).catch(() => {});
  }, [filter]);

  // New post from the menu (⌘⇧N), the button, or Share to Wins (which brings a draft).
  const [draft, setDraft] = useState<{ category: CategoryKey; text: string } | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ category: CategoryKey; text: string } | undefined>).detail;
      if (detail) { setDraft(detail); setFilter("all"); }
      setWriting(true);
      scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("ch:new-post", open);
    return () => window.removeEventListener("ch:new-post", open);
  }, []);

  const pinnedIds = new Set((filter === "all" ? pinned.data ?? [] : []).map((p) => p.id));
  const posts = (feed.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !pinnedIds.has(p.id));

  return (
    <div className="home">
      <div className="mhead">
        <h1>Home</h1>
        <div className="seg home-tabs">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.key} className={filter === c.key ? "on" : ""} title={c.label} onClick={() => setFilter(c.key)}>
              <span>{c.emoji}</span><span className="lbl">{c.label}</span>{unread[c.key] ? <i className="udot" /> : null}
            </button>
          ))}
        </div>
        <div className="acts"><button className="btn honey" onClick={() => setWriting(true)}><SquarePen />New post<span className="kbd-in">⇧⌘N</span></button></div>
      </div>
      <div className="home-body">
        <div className="feed scroll" ref={scroller} onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 600 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}>
          <div className="feed-col">
            <PaidCard />
            <NewPost key={draft?.text ?? "blank"} user={user} open={writing} draft={draft} onOpen={() => setWriting(true)} onClose={() => { setWriting(false); setDraft(null); }} />
            {filter === "all" ? (pinned.data ?? []).map((post) => <PostCard key={post.id} post={post} user={user} onOpen={(p) => setOpenPost(p.id)} />) : null}
            {feed.isLoading ? <div className="msgs-skel"><div /><div /><div /></div> : null}
            {feed.isError ? <div className="err-state">Couldn't load the feed.<button className="btn" onClick={() => void feed.refetch()}>Try again</button></div> : null}
            {posts.map((post) => <PostCard key={post.id} post={post} user={user} onOpen={(p) => setOpenPost(p.id)} />)}
            {feed.isSuccess && posts.length === 0 && pinnedIds.size === 0 ? <div className="empty-state">Nothing here yet.</div> : null}
            {feed.isFetchingNextPage ? <div className="faint" style={{ textAlign: "center", padding: 12 }}>Loading…</div> : null}
          </div>
        </div>
        <TodayPanel />
      </div>
      {openPost ? <PostSheet postId={openPost} user={user} onClose={() => { setOpenPost(null); if (openPostId) nav.open({ kind: "feed" }); }} /> : null}
    </div>
  );
}
