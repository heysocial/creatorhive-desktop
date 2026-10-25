import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { PageEditor, knowVersion, savePage } from "./PageEditor";
import { ChevronDown, ChevronRight, File as FileIcon, FileText, Link2, Plus, Search, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, ApiError, queryClient } from "../../lib/api";
import { bytes, shortTime } from "../../lib/format";
import { RichText, openLink } from "../../lib/html";
import { nav } from "../../lib/nav";

/*
  Resources: the member's own pages (the website's Notion-like workspace,
  /api/resources) when it's switched on for them, otherwise the shared
  CreatorHive guides (/api/pages). Pages read here; files open in Quick Look.
  Writing a page's body happens on the website for now.
*/

interface PageNode { id: string; parentId: string | null; title: string; icon: string | null; sortKey: string; updatedAt: string }
interface ResFile { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number; url: string }
interface PageDetail extends PageNode { doc: TipNode; version: number; archivedAt: string | null; breadcrumbs: { id: string; title: string; icon: string | null }[]; files: Record<string, ResFile>; coverFileId: string | null }
interface TipNode { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: TipNode[] }
interface WikiPage { id: string; parentId: string | null; title: string; icon: string | null; isPublished: boolean; starred: boolean }

export function useResourcesAccess() {
  return useQuery({
    queryKey: ["resources", "access"],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => { try { return (await api<{ enabled: boolean }>("/api/resources/access")).enabled; } catch { return false; } },
  });
}

export function useResourcePages(enabled: boolean) {
  return useQuery({ queryKey: ["resources", "pages"], enabled, queryFn: async () => (await api<{ pages: PageNode[] }>("/api/resources/pages")).pages });
}
export function useWikiPages(enabled: boolean) {
  return useQuery({ queryKey: ["wiki", "pages"], enabled, retry: false, queryFn: async () => (await api<{ pages: WikiPage[] }>("/api/pages")).pages });
}

/* ---------- TipTap JSON, drawn read-only ---------- */

function Marks({ node }: { node: TipNode }) {
  let out: ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "strike") out = <s>{out}</s>;
    else if (mark.type === "code") out = <code>{out}</code>;
    else if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "");
      out = <a href={href} onClick={(e) => { e.preventDefault(); void openLink(href); }}>{out}</a>;
    }
  }
  return <>{out}</>;
}

function Doc({ node, files }: { node: TipNode; files: Record<string, ResFile> }): ReactNode {
  const kids = (node.content ?? []).map((child, i) => <Fragment key={i}><Doc node={child} files={files} /></Fragment>);
  switch (node.type) {
    case "doc": return <>{kids}</>;
    case "paragraph": return <p>{kids.length ? kids : <br />}</p>;
    case "text": return <Marks node={node} />;
    case "heading": return Number(node.attrs?.level) === 2 ? <h2>{kids}</h2> : <h3>{kids}</h3>;
    case "bulletList": return <ul>{kids}</ul>;
    case "orderedList": return <ol>{kids}</ol>;
    case "listItem": return <li>{kids}</li>;
    case "taskList": return <ul className="tasks">{kids}</ul>;
    case "taskItem": return <li className={node.attrs?.checked ? "done" : ""}><input type="checkbox" checked={Boolean(node.attrs?.checked)} readOnly /> <div>{kids}</div></li>;
    case "blockquote": return <blockquote>{kids}</blockquote>;
    case "horizontalRule": return <hr />;
    case "hardBreak": return <br />;
    case "details": return <details open>{kids}</details>;
    case "detailsSummary": return <summary>{kids}</summary>;
    case "detailsContent": return <div>{kids}</div>;
    case "resourceImage": {
      const file = files[String(node.attrs?.fileId)];
      return file ? <button className="doc-img" onClick={() => void ch.files.quickLook(`/api/resources/files/${file.id}`, file.filename)}><img src={file.url} alt={String(node.attrs?.alt ?? "")} /></button> : null;
    }
    case "resourceFile": {
      const file = files[String(node.attrs?.fileId)];
      return file ? (
        <button className="file-card" onClick={() => void ch.files.quickLook(`/api/resources/files/${file.id}`, file.filename)}
          onContextMenu={async (e) => { e.preventDefault(); if ((await ch.menu.popup([{ id: "save", label: "Save to Downloads…" }])) === "save") void ch.files.save(`/api/resources/files/${file.id}`, file.filename); }}>
          <span className={`ficon ${/pdf/.test(file.mimeType) ? "pdf" : ""}`}>{/pdf/.test(file.mimeType) ? "PDF" : <FileIcon />}</span>
          <span className="fmeta"><b>{file.filename}</b><span>{bytes(file.sizeBytes)} · Click for Quick Look</span></span>
        </button>
      ) : null;
    }
    case "bookmark": {
      const url = String(node.attrs?.url ?? "");
      return <button className="bookmark" onClick={() => void openLink(url)}><Link2 /><span><b>{String(node.attrs?.title ?? url)}</b><small className="faint">{url}</small></span></button>;
    }
    case "pageLink":
      return <button className="link" onClick={() => nav.open({ kind: "resource", id: String(node.attrs?.pageId) }, "learn", "ch")}><FileText />Open linked page</button>;
    default: return <>{kids}</>;
  }
}

/* ---------- Your pages ---------- */

function MyPage({ id }: { id: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  useEffect(() => { void ch.auth.session().then(({ user }) => setUserId(user?.id ?? null)); }, []);
  const page = useQuery({ queryKey: ["resources", "page", id], queryFn: async () => (await api<{ page: PageDetail }>(`/api/resources/pages/${id}`)).page });
  const [title, setTitle] = useState<string | null>(null);
  const p = page.data;
  async function saveTitle() {
    if (!p || title === null || title === p.title) return setTitle(null);
    try {
      knowVersion(id, p.version);
      await savePage(id, { title });
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") window.alert("This page changed somewhere else. It's been reloaded.");
    }
    setTitle(null);
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
  }
  if (page.isError) return <div className="empty-state">This page isn't available.</div>;
  if (!p) return <div className="empty-state">Loading…</div>;
  const cover = p.coverFileId ? p.files[p.coverFileId] : null;
  return (
    <div className="doc-page scroll">
      {cover ? <div className="doc-cover"><img src={cover.url} alt="" /></div> : null}
      <div className="doc-inner">
        <div className="crumbs faint">{p.breadcrumbs.map((b) => <button key={b.id} onClick={() => nav.open({ kind: "resource", id: b.id }, "learn", "ch")}>{b.icon} {b.title || "Untitled"} /</button>)}</div>
        <div className="doc-title">
          <span className="doc-icon">{p.icon ?? "📄"}</span>
          <input value={title ?? (p.title || "")} placeholder="Untitled" onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveTitle()} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        </div>
        <div className="row faint" style={{ fontSize: 12.5 }}>Edited {shortTime(p.updatedAt)} · Only you</div>
        {userId && !p.archivedAt ? (
          <PageEditor key={`${id}:${reloads}`} pageId={id} userId={userId} initialDoc={p.doc as never} version={p.version} files={p.files}
            onSaved={() => void queryClient.invalidateQueries({ queryKey: ["resources", "pages"] })}
            onConflict={() => { window.alert("This page changed somewhere else. It's been reloaded."); void page.refetch().then(() => setReloads((n) => n + 1)); }} />
        ) : <div className="rich doc-body selectable"><Doc node={p.doc} files={p.files} /></div>}
      </div>
    </div>
  );
}

/* ---------- The shared CreatorHive guides ---------- */

function WikiPageView({ id }: { id: string }) {
  const page = useQuery({ queryKey: ["wiki", "page", id], queryFn: async () => (await api<{ page: { title: string; icon: string | null; body: string; authorName: string | null; updatedAt: string } }>(`/api/pages/${id}`)).page });
  if (!page.data) return <div className="empty-state">{page.isError ? "This guide isn't available." : "Loading…"}</div>;
  return (
    <div className="doc-page scroll">
      <div className="doc-inner">
        <div className="doc-title"><span className="doc-icon">{page.data.icon ?? "📘"}</span><h1>{page.data.title}</h1></div>
        <div className="faint" style={{ fontSize: 12.5 }}>{page.data.authorName ? `By ${page.data.authorName} · ` : ""}Updated {shortTime(page.data.updatedAt)}</div>
        <RichText html={page.data.body} className="rich doc-body selectable" />
      </div>
    </div>
  );
}

function Tree({ pages, parent, depth, current, onOpen }: { pages: PageNode[]; parent: string | null; depth: number; current?: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const children = pages.filter((p) => p.parentId === parent).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return (
    <>
      {children.map((p) => {
        const hasKids = pages.some((x) => x.parentId === p.id);
        return (
          <Fragment key={p.id}>
            <div className={`tree-row ${current === p.id ? "on" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
              <button className="tw" onClick={() => setOpen({ ...open, [p.id]: !open[p.id] })} style={{ visibility: hasKids ? "visible" : "hidden" }}>{open[p.id] ? <ChevronDown /> : <ChevronRight />}</button>
              <button className="tl" onClick={() => onOpen(p.id)}><span>{p.icon ?? "📄"}</span>{p.title || "Untitled"}</button>
            </div>
            {open[p.id] ? <Tree pages={pages} parent={p.id} depth={depth + 1} current={current} onOpen={onOpen} /> : null}
          </Fragment>
        );
      })}
    </>
  );
}

export function Resources({ pageId }: { pageId?: string }) {
  const access = useResourcesAccess();
  const mine = useResourcePages(access.data === true);
  const wiki = useWikiPages(access.data === false);
  const [q, setQ] = useState("");
  const search = useQuery({
    queryKey: ["resources", "search", q],
    enabled: access.data === true && q.trim().length >= 2,
    queryFn: async () => (await api<{ results: { id: string; title: string; icon: string | null; snippet: string }[] }>(`/api/resources/search?q=${encodeURIComponent(q.trim())}`)).results,
  });
  // The guides search, as the website's Resources page has it.
  const guideSearch = useQuery({
    queryKey: ["wiki", "search", q],
    enabled: access.data === false && q.trim().length >= 2,
    queryFn: async () => {
      const { results } = await api<{ results: { id: string; title: string; icon: string | null; snippet: string }[] }>(`/api/pages/search?q=${encodeURIComponent(q.trim())}`);
      // The server can answer with every published guide for members: keep the ones that match.
      const needle = q.trim().toLowerCase();
      return results.filter((r) => `${r.title} ${r.snippet}`.toLowerCase().includes(needle));
    },
  });
  const open = (id: string) => nav.open({ kind: "resource", id }, "learn", "ch");
  const wikiPages = useMemo(() => (wiki.data ?? []).filter((p) => p.isPublished !== false), [wiki.data]);

  async function newPage(parentId: string | null = null) {
    try {
      const { page } = await api<{ page: PageNode }>("/api/resources/pages", { method: "POST", body: { parentId, title: "" } });
      await queryClient.invalidateQueries({ queryKey: ["resources", "pages"] });
      open(page.id);
    } catch {
      window.alert("Couldn't add a page.");
    }
  }

  return (
    <div className="page">
      <div className="mhead">
        <h1>Resources</h1><span className="sub">{access.data ? "Your pages · Only you" : "CreatorHive guides"}</span>
        <div className="acts">
          {access.data ? <button className="btn honey" onClick={() => void newPage()}><Plus />New page</button> : null}
          {pageId && access.data ? <button className="btn" onClick={async () => {
            if (!window.confirm("Move this page to the trash?")) return;
            await api(`/api/resources/pages/${pageId}`, { method: "DELETE" }).catch(() => null);
            void queryClient.invalidateQueries({ queryKey: ["resources"] });
            nav.open({ kind: "learn", page: "resources" }, "learn", "ch");
          }}><Trash2 />Trash</button> : null}
        </div>
      </div>
      <div className="res-body">
        <aside className="res-tree scroll">
          {access.data ? (
            <>
              <label className="search-inline" style={{ margin: "0 6px 8px" }}><Search /><input placeholder="Search your pages" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              {q.trim().length >= 2 ? (search.data ?? []).map((r) => (
                <button key={r.id} className="tree-hit" onClick={() => open(r.id)}><b>{r.icon} {r.title || "Untitled"}</b><small className="faint">{r.snippet}</small></button>
              )) : <Tree pages={mine.data ?? []} parent={null} depth={0} current={pageId} onOpen={open} />}
              {mine.data?.length === 0 ? <p className="faint" style={{ padding: 10 }}>No pages yet. Make your rate card, pitch tracker or hook ideas.</p> : null}
            </>
          ) : (
            <>
              <label className="search-inline" style={{ margin: "0 6px 8px" }}><Search /><input placeholder="Search guides" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              {q.trim().length >= 2 ? (
                <>
                  {(guideSearch.data ?? []).map((r) => (
                    <button key={r.id} className="tree-hit" onClick={() => open(r.id)}><b>{r.icon ?? "📘"} {r.title}</b><small className="faint">{r.snippet}</small></button>
                  ))}
                  {guideSearch.data?.length === 0 ? <p className="faint" style={{ padding: 10 }}>No guides match.</p> : null}
                </>
              ) : wikiPages.map((p) => <button key={p.id} className={`tree-row tl solo ${pageId === p.id ? "on" : ""}`} onClick={() => open(p.id)}><span>{p.icon ?? "📘"}</span>{p.title}</button>)}
            </>
          )}
        </aside>
        <div className="res-main">
          {pageId ? (access.data ? <MyPage key={pageId} id={pageId} /> : <WikiPageView key={pageId} id={pageId} />)
            : <div className="empty-state">{access.isLoading ? "Loading…" : "Pick a page on the left."}</div>}
        </div>
      </div>
    </div>
  );
}
