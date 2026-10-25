import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Plus, SendHorizontal, Sparkles, Square } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, queryClient } from "../../lib/api";
import { shortTime } from "../../lib/format";
import { Markdown } from "../../lib/html";
import { nav } from "../../lib/nav";

interface ChatSummary { id: string; title: string | null; adType: string | null; replies: number; updatedAt: string }
interface ChatMessage { id: string; role: "user" | "assistant"; body: string; linkUrl: string | null; status: "complete" | "stopped" | "failed" | "declined" | "streaming" }

const useChats = () => useQuery({ queryKey: ["script-writer", "chats"], queryFn: async () => (await api<{ chats: ChatSummary[] }>("/api/improve/script-writer/chats")).chats });

const STARTERS = [
  "Write 3 UGC scripts for a vitamin C serum, 30 seconds, for TikTok",
  "Hooks for a coffee subscription unboxing",
  "A testimonial-style script for a pet water fountain",
];

/** The AI Script Writer, built in, as on the website: streaming replies, Stop, and your past chats. */
export function ScriptWriter({ chatId }: { chatId?: string }) {
  const chats = useChats();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const activeChat = useRef<string | undefined>(chatId);
  const startedHere = useRef<string | null>(null);

  useEffect(() => {
    // The chat this window just started: its messages are already here, still streaming.
    if (chatId && chatId === startedHere.current) return;
    // Anywhere else (a new chat, another chat), coming back to it later loads it like any other.
    startedHere.current = null;
    activeChat.current = chatId;
    setError(null);
    if (!chatId) { setMessages([]); return; }
    void api<{ chat: { messages: ChatMessage[] } }>(`/api/improve/script-writer/chats/${chatId}`).then((r) => setMessages(r.chat.messages)).catch(() => setError("Couldn't open this chat."));
  }, [chatId]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [messages]);

  async function send(body = text) {
    if ((!body.trim() && !link.trim()) || busy) return;
    setBusy(true);
    setError(null);
    const pending: ChatMessage = { id: `u-${Date.now()}`, role: "user", body: body.trim(), linkUrl: link.trim() || null, status: "complete" };
    const reply: ChatMessage = { id: `a-${Date.now()}`, role: "assistant", body: "", linkUrl: null, status: "streaming" };
    setMessages((m) => [...m, pending, reply]);
    setText("");
    setLink("");
    setShowLink(false);
    let gotDone = false;
    const result = await ch.apiStream({ path: "/api/improve/script-writer/messages", body: { chatId: activeChat.current, text: body.trim(), ...(pending.linkUrl ? { link: pending.linkUrl } : {}) } }, (line) => {
      let event: { type: string; text?: string; chatId?: string; status?: ChatMessage["status"]; message?: string; messageId?: string };
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "start" && event.chatId && !activeChat.current) {
        activeChat.current = event.chatId;
        startedHere.current = event.chatId;
        nav.open({ kind: "script-writer", chatId: event.chatId }, "learn", "ch");
      }
      if (event.type === "text") setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, body: x.body + (event.text ?? "") } : x)));
      if (event.type === "done") { gotDone = true; setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, status: event.status ?? "complete" } : x))); }
      if (event.type === "error") { gotDone = true; setError(event.message ?? "The Script Writer couldn't answer."); setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, status: "failed" } : x))); }
    });
    if (!result.ok) {
      const code = (result.data as { error?: string } | undefined)?.error ?? result.error;
      setError(code === "BUSY" ? "Still writing the last reply." : code === "CHAT_LIMIT" ? "This chat is full. Start a new one." : code === "BAD_LINK" ? "That link doesn't look right." : "The Script Writer couldn't answer. Try again.");
      setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, status: "failed" } : x)));
    } else if (!gotDone) {
      setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, status: x.body ? "stopped" : "failed" } : x)));
    }
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: ["script-writer", "chats"] });
  }

  async function stop() {
    if (activeChat.current) await api(`/api/improve/script-writer/chats/${activeChat.current}/stop`, { method: "POST" }).catch(() => null);
  }

  return (
    <div className="page sw">
      <div className="mhead"><h1><Sparkles />AI Script Writer</h1><span className="sub">Scripts, hooks and shot lists for your next brand video</span>
        <div className="acts"><button className="btn" onClick={() => nav.open({ kind: "script-writer" }, "learn", "ch")}><Plus />New chat</button></div></div>
      <div className="sw-body">
        <aside className="sw-chats scroll">
          {chats.data?.length === 0 ? <p className="faint" style={{ padding: 12 }}>Your chats show up here.</p> : null}
          {chats.data?.map((c) => (
            <button key={c.id} className={`sw-chat ${c.id === chatId ? "on" : ""}`} onClick={() => nav.open({ kind: "script-writer", chatId: c.id }, "learn", "ch")}
              onContextMenu={async (e) => {
                e.preventDefault();
                if ((await ch.menu.popup([{ id: "delete", label: "Delete chat" }])) === "delete") {
                  await api(`/api/improve/script-writer/chats/${c.id}`, { method: "DELETE" }).catch(() => null);
                  void queryClient.invalidateQueries({ queryKey: ["script-writer", "chats"] });
                  if (c.id === chatId) nav.open({ kind: "script-writer" }, "learn", "ch");
                }
              }}>
              <b>{c.title ?? "New chat"}</b><small className="faint">{shortTime(c.updatedAt)}{c.adType ? ` · ${c.adType}` : ""}</small>
            </button>
          ))}
        </aside>
        <div className="sw-main">
          <div className="sw-msgs scroll" ref={scroller}>
            {messages.length === 0 && !chatId ? (
              <div className="sw-empty">
                <span className="t-ico honey big"><Sparkles /></span>
                <h2>What are we filming?</h2>
                <p className="muted">Name the product (or paste its link), the platform and the length. You'll get hooks, scripts, a shot list and a filming checklist.</p>
                <div className="sw-starters">{STARTERS.map((s) => <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>)}</div>
              </div>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`sw-msg ${m.role}`}>
                {m.role === "user" ? (
                  <div className="bubble selectable">{m.body}{m.linkUrl ? <div className="faint"><Link2 />{m.linkUrl}</div> : null}</div>
                ) : (
                  <div className="sw-reply selectable">
                    {m.body ? <Markdown text={m.body} /> : m.status === "streaming" ? <span className="faint"><Loader2 className="spin" /> Writing…</span> : null}
                    {m.status === "stopped" ? <div className="faint">Stopped.</div> : null}
                    {m.status === "failed" ? <div className="late-text">This reply didn't finish.</div> : null}
                    {m.body && m.status !== "streaming" ? <button className="link" onClick={() => void navigator.clipboard.writeText(m.body)}>Copy</button> : null}
                  </div>
                )}
              </div>
            ))}
          </div>
          {error ? <div className="sw-error">{error}</div> : null}
          <div className="composer sw-composer">
            {showLink ? <input className="field sw-link" placeholder="https:// product page" value={link} onChange={(e) => setLink(e.target.value)} /> : null}
            <textarea rows={2} value={text} placeholder="Describe the product and the video you need…" maxLength={10000} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <div className="tools">
              <button title="Add the product's link" onClick={() => setShowLink(!showLink)}><Link2 /></button>
              {busy ? <button className="send on" title="Stop" onClick={() => void stop()}><Square /></button>
                : <button className={`send ${text.trim() || link.trim() ? "on" : ""}`} disabled={!text.trim() && !link.trim()} onClick={() => void send()}><SendHorizontal /></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

