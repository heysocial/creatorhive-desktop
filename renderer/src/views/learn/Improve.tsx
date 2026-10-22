import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Lock, Sparkles, Target } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ch } from "../../lib/bridge";
import { api, queryClient } from "../../lib/api";
import { useImprove, useImproveResources, type Improve as ImproveData, type Milestone } from "../../lib/learn";
import { nav } from "../../lib/nav";

function Ring({ pct }: { pct: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} className="track" />
      <circle cx="55" cy="55" r={r} className="fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 55 55)" />
      <text x="55" y="61" textAnchor="middle">{pct}%</text>
    </svg>
  );
}

async function toggleItem(itemId: string, completed: boolean) {
  // Optimistic, then the server's word.
  queryClient.setQueryData<ImproveData>(["improve"], (data) => data && ({
    ...data,
    activationPoints: data.activationPoints.map((m) => {
      const items = m.items.map((i) => (i.id === itemId ? { ...i, completed } : i));
      const completedCount = items.filter((i) => i.completed).length;
      return { ...m, items, completedCount, completed: completedCount === m.totalCount };
    }),
  }));
  try {
    await api("/api/improve/progress", { method: "PATCH", body: { itemId, completed } });
  } finally {
    void queryClient.invalidateQueries({ queryKey: ["improve"] });
  }
}

function MilestoneCard({ m, open, onToggle }: { m: Milestone; open: boolean; onToggle: () => void }) {
  return (
    <div className={`card milestone ${m.completed ? "done" : ""} ${m.locked ? "locked" : ""}`}>
      <button className="ms-head" onClick={onToggle}>
        <span className="ms-ico">{m.completed ? <Check /> : m.locked ? <Lock /> : <Target />}</span>
        <span className="ms-title"><small>{m.number}{m.beeLabel ? ` · ${m.beeLabel}` : ""}</small><b>{m.title}</b></span>
        <span className="muted">{m.completedCount}/{m.totalCount}</span>
        {open ? <ChevronDown /> : <ChevronRight />}
      </button>
      <span className="bar"><i style={{ width: `${m.totalCount ? (m.completedCount / m.totalCount) * 100 : 0}%` }} /></span>
      {open ? (
        <div className="ms-items">
          {m.items.map((item) => (
            <button key={item.id} className={`ms-item ${item.completed ? "on" : ""}`} disabled={m.locked || item.mode === "auto"}
              title={item.mode === "auto" ? "Completed automatically from your app activity" : undefined}
              onClick={() => void toggleItem(item.id, !item.completed)}>
              <span className="box">{item.completed ? <Check /> : null}</span>
              <span>{item.label}</span>
              {item.mode === "auto" ? <span className="tag-s">Auto</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ImprovePage() {
  const { data, isLoading, isError } = useImprove();
  const resources = useImproveResources().data;
  const calls = useQuery({
    queryKey: ["improve", "calls"],
    retry: false,
    queryFn: async () => { try { return (await api<{ calls: { groupCount: number; privateCount: number; privateByCoach: { name: string; count: number }[] } }>("/api/improve/calls")).calls; } catch { return null; } },
  }).data;
  const current = data?.activationPoints.find((m) => m.current)?.id ?? null;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allResources, setAllResources] = useState(false);

  return (
    <div className="page">
      <div className="mhead"><h1>Improve</h1><span className="sub">Your grade, your milestones, and what to do next.</span></div>
      <div className="scroll page-body improve-body">
        {isLoading ? <div className="empty-state">Loading…</div> : null}
        {isError ? <div className="empty-state">Couldn't load Improve.</div> : null}
        {data ? (
          <div className="card grade">
            <Ring pct={data.grade.overallPercentage} />
            <div className="grade-text">
              <span className="section-label">Overall grade</span>
              <div className="kv"><span>Course completion</span><b>{data.grade.completedLessons}/{data.grade.totalLessons} lessons · {data.grade.coursePercentage}%</b></div>
              <div className="kv"><span>Milestones</span><b>{data.grade.completedItems}/{data.grade.totalItems} items · {data.grade.apPercentage}%</b></div>
              <p className="faint">Course completion and milestone progress average into your grade.</p>
              {calls ? (
                <p className="muted">{calls.groupCount} group coaching {calls.groupCount === 1 ? "call" : "calls"} in the last 60 days
                  {calls.privateByCoach.length ? ` · ${calls.privateByCoach.map((c) => `${c.count} private with ${c.name}`).join(", ")} (not part of the grade)` : ""}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {resources ? (
          <section>
            <div className="sec-head"><h2>Resources</h2><span className="muted">Tools, scripts, and manuals to move faster.</span></div>
            <div className="res-grid">
              {(allResources ? resources : resources.slice(0, 3)).map((r) => (
                <button key={r.id} className="card res-tile" onClick={() => (r.slug === "ai-script-writer" ? nav.open({ kind: "script-writer" }, "learn", "ch") : ch.app.openSite(`/library/resources/${r.slug}`))}>
                  <span className="res-top"><span className="t-ico honey"><Sparkles /></span>{r.flagship ? <span className="tag-s honey">Flagship</span> : null}<ArrowUpRight className="arrow" /></span>
                  <b>{r.title}</b><span className="muted">{r.description}</span><small className="faint">{r.type}</small>
                </button>
              ))}
            </div>
            {resources.length > 3 ? <button className="show-more" onClick={() => setAllResources(!allResources)}>{allResources ? "Show fewer" : `Show all ${resources.length} resources`}</button> : null}
          </section>
        ) : null}
        {data ? (
          <section>
            <div className="sec-head"><h2>Milestones</h2><span className="muted">Your journey from first video to $5K months · {data.completedStages}/{data.activationPoints.length} complete</span></div>
            <div className="ms-list">
              {data.activationPoints.map((m) => <MilestoneCard key={m.id} m={m} open={open[m.id] ?? m.id === current} onToggle={() => setOpen({ ...open, [m.id]: !(open[m.id] ?? m.id === current) })} />)}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
