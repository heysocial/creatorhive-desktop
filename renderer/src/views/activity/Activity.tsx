import { useEffect, useMemo } from "react";
import { AtSign, Bell, CheckCheck, Heart, Megaphone, MessageCircle, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, queryClient, useChannels, useConversations } from "../../lib/api";
import { ch } from "../../lib/bridge";
import { shortTime } from "../../lib/format";
import { allDeals, localToday, useDeals } from "../../lib/hub";
import { openPath } from "../../lib/links";
import { nav } from "../../lib/nav";
import { Avatar, channelName } from "../../lib/ui";
import { useGlance } from "../home/Home";
import { money } from "../../lib/format";

/*
  One inbox for both workspaces and the Hub. The website's notifications
  (comments, replies, reactions, mentions in posts, announcements) are joined
  by what the app already knows: unread DMs, channel @mentions, and the Hub's
  drafts and payments due.
*/

export interface Notification { id: string; type: string; title: string; body: string | null; link: string | null; payload: { actorId?: string; emoji?: string } | null; readAt: string | null; createdAt: string }
export type ActivityFilter = "all" | "mentions" | "comments" | "reactions" | "hub" | "announcements";

export function useNotifications() {
  return useQuery({ queryKey: ["notifications"], queryFn: () => api<{ unread: number; notifications: Notification[] }>("/api/notifications") });
}

interface Row { id: string; kind: ActivityFilter | "dm"; icon: React.ReactNode; who: string; what: string; quote: string | null; tag: string; when: string; unread: boolean; open: () => void }

const ICONS: Record<string, React.ReactNode> = {
  post_comment: <MessageCircle />, comment_reply: <MessageCircle />, post_reaction: <Heart />, post_mention: <AtSign />, announcement: <Megaphone />,
};
const KIND: Record<string, ActivityFilter> = { post_comment: "comments", comment_reply: "comments", post_reaction: "reactions", post_mention: "mentions", announcement: "announcements" };

export function useActivityRows() {
  const notes = useNotifications().data;
  const ch1 = useChannels("creatorhive").data ?? [];
  const hsAccess = queryClient.getQueryData<boolean>(["hey-social-access"]) === true;
  const ch2 = useChannels("heysocial", hsAccess).data ?? [];
  const dms = useConversations("creatorhive").data ?? [];
  const deals = allDeals(useDeals().data);
  const glance = useGlance().data;

  return useMemo(() => {
    const rows: Row[] = [];
    for (const n of notes?.notifications ?? []) {
      const actor = n.title.split(" ")[0] ?? "";
      rows.push({
        id: n.id, kind: KIND[n.type] ?? "all", icon: ICONS[n.type] ?? <Bell />,
        who: n.type === "announcement" ? "CreatorHive" : n.title.replace(/ (commented|replied|reacted|mentioned).*$/, "") || actor,
        what: n.type === "announcement" ? "announcement" : n.title.replace(/^.*? (commented|replied|reacted|mentioned)/, "$1"),
        quote: n.body, tag: "CreatorHive", when: n.createdAt, unread: !n.readAt,
        open: () => {
          if (!n.readAt) void api("/api/notifications", { method: "POST", body: { action: "mark_read", id: n.id } }).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }));
          if (n.link) openPath(n.link);
        },
      });
    }
    for (const [list, tag, ws] of [[ch1, "CreatorHive", "ch"], [ch2, "Hey Social Inc.", "hs"]] as const) {
      for (const c of list) {
        if (!c.mentionCount) continue;
        rows.push({ id: `m-${c.id}`, kind: "mentions", icon: <AtSign />, who: `#${channelName(c.name)}`, what: `${c.mentionCount} unread ${c.mentionCount === 1 ? "mention" : "mentions"}`, quote: null, tag, when: c.lastMessageAt ?? new Date().toISOString(), unread: true,
          open: () => nav.open({ kind: "channel", id: c.id }, "home", ws) });
      }
    }
    for (const c of dms.filter((d) => d.unreadCount)) {
      rows.push({ id: `d-${c.id}`, kind: "dm", icon: <MessageCircle />, who: c.displayName, what: `${c.unreadCount} new ${c.unreadCount === 1 ? "message" : "messages"}`, quote: c.lastMessagePreview, tag: "CreatorHive", when: c.lastMessageAt ?? "", unread: true,
        open: () => nav.open({ kind: "dm", id: c.id }, "home", "ch") });
    }
    const today = localToday();
    for (const d of deals) {
      if (d.draft_due_at && d.draft_due_at <= today && d.status !== "completed" && ["pitching", "deliverables_contract", "deal_secured", "waiting_product", "production", "post_production", "revisions"].includes(d.status)) {
        rows.push({ id: `h-${d.id}`, kind: "hub", icon: <Sparkles />, who: d.brand_name, what: d.draft_due_at === today ? "Draft due today" : "Draft overdue", quote: `${money(d.amount_usd)}${d.deliverables ? ` · ${d.deliverables}` : ""}`, tag: "Hub", when: `${d.draft_due_at}T08:00:00`, unread: true,
          open: () => nav.open({ kind: "hub", page: "deals", dealId: d.id }, "hub", "ch") });
      }
    }
    for (const g of glance?.pastDue.deals ?? []) {
      rows.push({ id: `p-${g.id}`, kind: "hub", icon: <Sparkles />, who: g.brandName, what: `Payment is ${g.daysOverdue} ${g.daysOverdue === 1 ? "day" : "days"} late`, quote: money(g.amountUsd), tag: "Hub", when: `${g.paymentExpectedAt ?? today}T08:00:00`, unread: true,
        open: () => nav.open({ kind: "hub", page: "deals", dealId: g.id }, "hub", "ch") });
    }
    return rows.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [notes, ch1, ch2, dms, deals, glance]);
}

export function Activity({ filter = "all" }: { filter?: ActivityFilter }) {
  const rows = useActivityRows();
  const shown = rows.filter((r) => filter === "all" || r.kind === filter);
  const { isLoading } = useNotifications();

  // Seeing the inbox refreshes it.
  useEffect(() => { void queryClient.invalidateQueries({ queryKey: ["notifications"] }); }, []);

  async function markAll() {
    await api("/api/notifications", { method: "POST", body: { action: "mark_all_read" } }).catch(() => null);
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    ch.app.refreshBadge();
  }

  const titles: Record<ActivityFilter, string> = { all: "All activity", mentions: "Mentions", comments: "Comments and replies", reactions: "Reactions", hub: "Hub reminders", announcements: "Announcements" };
  return (
    <div className="page">
      <div className="mhead">
        <h1>{titles[filter]}</h1><span className="sub">Both workspaces and your Hub, newest first</span>
        <div className="acts"><button className="btn" onClick={() => void markAll()}><CheckCheck />Mark all read</button></div>
      </div>
      <div className="scroll activity-list">
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {!isLoading && shown.length === 0 ? <div className="empty-state">You're all caught up.</div> : null}
        {shown.map((r) => (
          <button key={r.id} className={`act-row ${r.unread ? "unread" : ""}`} onClick={r.open}>
            <span className="act-av">{r.kind === "hub" ? <Avatar name={r.who} size={40} radius="10px" /> : <span className="t-ico">{r.icon}</span>}</span>
            <span className="act-text">
              <span><b>{r.who}</b> <span className="muted">{r.what}</span> <span className="tag-s">{r.tag}</span></span>
              {r.quote ? <span className="act-quote">“{r.quote}”</span> : null}
            </span>
            <span className="act-when faint">{shortTime(r.when)}</span>
            {r.unread ? <i className="act-dot" /> : <i className="act-dot off" />}
          </button>
        ))}
      </div>
    </div>
  );
}
