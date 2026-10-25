import { memo, useState } from "react";
import { Headphones, Bookmark, BookmarkCheck, FileText, MessageSquareText, MoreHorizontal, Pin, Play, Reply, SmilePlus, TriangleAlert } from "lucide-react";
import { ch } from "../../lib/bridge";
import type { Message, Reactions, VideoAttachment } from "../../lib/community";
import { bytes, clock } from "../../lib/format";
import { RichText } from "../../lib/html";
import { Avatar } from "../../lib/ui";
import { EmojiPicker } from "./EmojiPicker";
import { VideoPlayer } from "./VideoPlayer";
import { VoicePlayer } from "./VoicePlayer";

export interface RowActions {
  meId: string;
  isStaff: boolean;
  onReact: (message: Message, emoji: string) => void;
  onOpenThread?: (message: Message) => void;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message, body: string) => Promise<boolean>;
  onDelete?: (message: Message) => void;
  onPin?: (message: Message) => void;
  onRetry?: (message: Message) => void;
  onProfile?: (userId: string) => void;
  copyLink?: (message: Message) => void;
  /** Hey Social Inc.: Slack's ✅ 👀 🙌, and Save for later. */
  quickEmoji?: string[];
  isSaved?: (id: string) => boolean;
  onSave?: (message: Message, saved: boolean) => void;
}

export function Badge({ badge, role }: { badge?: { kind: string; label: string } | null; role?: string }) {
  const label = badge?.label ?? (role === "owner" ? "Owner" : role === "team" ? "Team" : null);
  if (!label) return null;
  return <span className={`badge-pill k-${badge?.kind ?? role}`}>{label}</span>;
}

function ReactionChips({ reactions, onToggle }: { reactions?: Reactions; onToggle: (emoji: string) => void }) {
  const entries = Object.entries(reactions ?? {}).filter(([, r]) => r.count > 0);
  const [picker, setPicker] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div className="reacts">
      {entries.map(([emoji, r]) => (
        <button key={emoji} className={`react ${r.mine ? "mine" : ""}`} onClick={() => onToggle(emoji)}>
          <span>{emoji}</span>{r.count}
        </button>
      ))}
      <span style={{ position: "relative" }}>
        <button className="react add" aria-label="Add reaction" onClick={() => setPicker(!picker)}><SmilePlus /></button>
        {picker ? <EmojiPicker onPick={(e) => { onToggle(e); setPicker(false); }} onClose={() => setPicker(false)} placement="above" /> : null}
      </span>
    </div>
  );
}

function fileNameFromUrl(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file").replace(/-[A-Za-z0-9]{20,}(?=\.)/, "");
  } catch {
    return "file";
  }
}

function Media({ message }: { message: Message }) {
  const attachments = message.attachments?.length
    ? message.attachments
    : message.mediaUrls.map((url) => ({ url, name: fileNameFromUrl(url), size: 0, mimeType: "", kind: /\.(png|jpe?g|gif|webp|heic)(\?|$)/i.test(url) ? "image" as const : "file" as const }));
  const videos: VideoAttachment[] = message.videoAttachments?.length ? message.videoAttachments : message.videoAttachment ? [message.videoAttachment] : [];
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");
  if (images.length + files.length + videos.length === 0 && !message.voiceMemo) return null;
  return (
    <div className="media">
      {message.voiceMemo ? <VoicePlayer memo={message.voiceMemo} /> : null}
      {images.length > 0 ? (
        <div className={`imgs n${Math.min(images.length, 4)}`}>
          {images.map((image) => (
            <button key={image.url} className="img" title="Click to preview (Quick Look)" onClick={() => void ch.files.quickLook(image.url, image.name)}
              onContextMenu={async (event) => {
                event.preventDefault();
                const choice = await ch.menu.popup([{ id: "look", label: "Quick Look" }, { id: "save", label: "Save to Downloads…" }, { id: "copy", label: "Copy image address" }]);
                if (choice === "look") void ch.files.quickLook(image.url, image.name);
                if (choice === "save") void ch.files.save(image.url, image.name);
                if (choice === "copy") void navigator.clipboard.writeText(image.url);
              }}>
              <img src={image.url} alt={image.name} loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
      {videos.map((video) => <VideoPlayer key={video.uid} video={video} />)}
      {files.map((file) => (
        <button key={file.url} className="file-card" onClick={() => void ch.files.quickLook(file.url, file.name)} title="Click to preview (Quick Look)"
          onContextMenu={async (event) => {
            event.preventDefault();
            const choice = await ch.menu.popup([{ id: "look", label: "Quick Look" }, { id: "save", label: "Save to Downloads…" }]);
            if (choice === "look") void ch.files.quickLook(file.url, file.name);
            if (choice === "save") void ch.files.save(file.url, file.name);
          }}>
          <span className={`ficon ${/pdf/i.test(file.mimeType || file.name) ? "pdf" : ""}`}>{/pdf/i.test(file.mimeType || file.name) ? "PDF" : <FileText />}</span>
          <span className="fmeta"><b>{file.name}</b><span>{[bytes(file.size), "Click to preview"].filter(Boolean).join(" · ")}</span></span>
        </button>
      ))}
    </div>
  );
}

interface Recap { durationSeconds: number; participants: { id: string; name: string; avatarUrl: string | null }[] }

/** "A huddle happened": who was there and for how long, as the website shows it. */
function HuddleRecap({ recap }: { recap: Recap }) {
  const names = recap.participants.map((p) => p.name.split(" ")[0]);
  const who = names.length <= 1 ? names[0] ?? "Someone" : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
  const s = recap.durationSeconds;
  const length = s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} m` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m`;
  return (
    <div className="huddle-recap">
      <span className="hr-ico"><Headphones /></span>
      <span><b>A huddle happened</b><small>{who} {names.length === 1 ? "was" : "were"} in the huddle for {length}.</small></span>
      <span className="hr-people">{recap.participants.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} src={p.avatarUrl} seed={p.id} size={24} />)}</span>
    </div>
  );
}

export function ThreadLine({ message, onOpen }: { message: Message; onOpen: () => void }) {
  const summary = message.threadSummary;
  if (!summary || summary.replyCount === 0) return null;
  return (
    <button className="thread-line" onClick={onOpen}>
      {summary.repliers.slice(0, 3).map((r) => <Avatar key={r.id} name={r.name} src={r.avatarUrl} seed={r.id} size={20} radius="5px" />)}
      <b>{summary.replyCount === 1 ? "1 reply" : `${summary.replyCount} replies`}</b>
      <span>Last reply {clock(summary.lastReplyAt)}</span>
    </button>
  );
}

export const MessageRow = memo(function MessageRow({ message, grouped, actions, inThread = false, receipt = null }: {
  message: Message;
  grouped: boolean;
  actions: RowActions;
  inThread?: boolean;
  /** Under your newest 1:1 DM: Sent, Delivered or Read, as on the website. */
  receipt?: string | null;
}) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const own = message.author.id === actions.meId;
  const local = message.id.startsWith("local-");

  async function more() {
    const items = [
      { id: "copy", label: "Copy text" },
      ...(actions.copyLink && !local ? [{ id: "link", label: "Copy link to message" }] : []),
      ...(actions.onPin && !inThread && !local ? [{ id: "pin", label: message.pin ? "Unpin from channel" : "Pin to channel" }] : []),
      ...(actions.onReply && !local ? [{ id: "reply", label: "Reply" }] : []),
      ...(own && actions.onEdit && !local ? [{ type: "separator" as const }, { id: "edit", label: "Edit message" }] : []),
      ...((own || actions.isStaff) && actions.onDelete && !local ? [{ id: "delete", label: "Delete message…" }] : []),
    ];
    const choice = await ch.menu.popup(items);
    if (choice === "copy") void navigator.clipboard.writeText(message.body);
    if (choice === "link") actions.copyLink?.(message);
    if (choice === "pin") actions.onPin?.(message);
    if (choice === "reply") actions.onReply?.(message);
    if (choice === "edit") setEditing(message.body);
    if (choice === "delete") actions.onDelete?.(message);
  }

  return (
    <div className={`msg ${grouped ? "grouped" : ""} ${message.pin && !inThread ? "pinned" : ""} ${message.sending ? "sending" : ""}`}
      data-message-id={message.id}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("button, a, img")) return;
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        void more();
      }}>
      {message.pin && !inThread ? <div className="pinned-by"><Pin />Pinned{message.pin.by ? ` by ${message.pin.by.name}` : ""}</div> : null}
      <div className="msg-body">
        <div className="gutter">
          {grouped ? <span className="gtime">{clock(message.createdAt).replace(/\s?[AP]M$/i, "")}</span> : (
            <button onClick={() => actions.onProfile?.(message.author.id)} aria-label={message.author.name}>
              <Avatar name={message.author.name} src={message.author.avatarUrl} seed={message.author.id} size={36} radius="9px" />
            </button>
          )}
        </div>
        <div className="content">
          {!grouped ? (
            <div className="who">
              <button className="name" onClick={() => actions.onProfile?.(message.author.id)}>{message.author.name}</button>
              <Badge badge={message.author.badge} role={message.author.role} />
              <span className="time">{clock(message.createdAt)}</span>
            </div>
          ) : null}
          {message.replyTo ? (
            <div className="quote"><b>{message.replyTo.author.name}</b> {message.replyTo.body}</div>
          ) : null}
          {message.huddle ? <HuddleRecap recap={message.huddle as Recap} /> : editing !== null ? (
            <div className="inline-edit">
              <textarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (await actions.onEdit!(message, editing)) setEditing(null);
                  }
                }} />
              <div className="hint">Escape to cancel · Return to save
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn honey" onClick={async () => { if (await actions.onEdit!(message, editing)) setEditing(null); }}>Save</button>
              </div>
            </div>
          ) : message.bodyHtml || message.body ? (
            <div className="text">
              <RichText html={message.bodyHtml} text={message.body} />
              {message.editedAt ? <span className="edited">(edited)</span> : null}
            </div>
          ) : null}
          <Media message={message} />
          {message.failed ? (
            <div className="failed"><TriangleAlert />Not sent.{actions.onRetry ? <button onClick={() => actions.onRetry?.(message)}>Try again</button> : null}</div>
          ) : null}
          <ReactionChips reactions={message.reactions} onToggle={(emoji) => actions.onReact(message, emoji)} />
          {!inThread && actions.onOpenThread ? <ThreadLine message={message} onOpen={() => actions.onOpenThread?.(message)} /> : null}
          {receipt ? <div className="receipt">{receipt}</div> : null}
        </div>
      </div>
      {!local ? (
        <div className={`hover-bar ${picker ? "show" : ""}`}>
          {(actions.quickEmoji ?? ["❤️", "👍", "😂", "🔥"]).map((emoji) => <button key={emoji} className="qe" onClick={() => actions.onReact(message, emoji)}>{emoji}</button>)}
          <span style={{ position: "relative" }}>
            <button title="Add reaction" onClick={() => setPicker(!picker)}><SmilePlus /></button>
            {picker ? <EmojiPicker onPick={(e) => { actions.onReact(message, e); setPicker(false); }} onClose={() => setPicker(false)} /> : null}
          </span>
          {actions.onOpenThread && !inThread ? <button title="Reply in thread" onClick={() => actions.onOpenThread?.(message)}><MessageSquareText /></button> : null}
          {actions.onReply ? <button title="Reply" onClick={() => actions.onReply?.(message)}><Reply /></button> : null}
          {actions.onSave ? (
            <button title={actions.isSaved?.(message.id) ? "Remove from saved" : "Save for later"} className={actions.isSaved?.(message.id) ? "saved" : ""}
              onClick={() => actions.onSave?.(message, !actions.isSaved?.(message.id))}>{actions.isSaved?.(message.id) ? <BookmarkCheck /> : <Bookmark />}</button>
          ) : null}
          <button title="More" onClick={() => void more()}><MoreHorizontal /></button>
        </div>
      ) : null}
    </div>
  );
});

/** A video's poster with a play button, for places that only preview (pins, search). */
export function PosterOnly({ video }: { video: VideoAttachment }) {
  return (
    <span className="poster">
      {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : null}
      <Play />
    </span>
  );
}
