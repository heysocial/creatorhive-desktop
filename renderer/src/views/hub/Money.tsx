import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Camera, Clapperboard, FileDown, Headset, Link2, Loader2, PiggyBank, Plus, Repeat, Tag } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ch } from "../../lib/bridge";
import {
  EXPENSE_CATEGORIES, allDeals, categoryOf, cents, daysBetween, errorText, localToday, moneyWrite, monDay, useDeals, useExpenses, useMoney, useSubscriptions, withTz,
  type Expense, type ExpenseCategory, type MoneySummary, type Subscription,
} from "../../lib/hub";
import { Modal, hubToast } from "./parts";

/*
  Money in & out, at the bottom of the Dashboard (the website's hand-off §11.3
  C): Your money, Expenses + Subscriptions, Tax time. The Hub's, so partners
  in a Shared Hub see the same. Plain words; money out is never red.
*/

const ICONS: Record<ExpenseCategory, typeof Tag> = { editor: Clapperboard, va: Headset, software: Repeat, equipment: Camera, other: Tag };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "180" or "31.99" → cents; null when it isn't an amount. */
function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const value = Math.round(Number(clean) * 100);
  return value >= 1 ? value : null;
}

function CategoryTile({ category, size = 36 }: { category: ExpenseCategory; size?: number }) {
  const Icon = ICONS[category];
  return <span className={`cat-tile s-${categoryOf(category).stage}`} style={{ width: size, height: size }}><Icon /></span>;
}

export function MoneySections() {
  const money = useMoney().data;
  const year = localToday().slice(0, 4);
  const monthKey = localToday().slice(0, 7);
  const expenses = useExpenses(`${year}-01-01`, `${year}-12-31`).data ?? [];
  const subs = useSubscriptions().data;
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [filter, setFilter] = useState<"all" | "one_time" | "subscription">("all");
  const [wholeYear, setWholeYear] = useState(false);
  const [editing, setEditing] = useState<{ kind: "expense"; expense?: Expense } | { kind: "subscription"; subscription?: Subscription } | null>(null);
  if (!money) return null;
  const summary = period === "month" ? money.month : money.year;
  const scope = expenses.filter((e) => wholeYear || e.spent_on.startsWith(monthKey));
  const listed = scope.filter((e) => filter === "all" || (filter === "subscription" ? e.subscription_id : !e.subscription_id));
  const counts = { all: scope.length, one_time: scope.filter((e) => !e.subscription_id).length, subscription: scope.filter((e) => e.subscription_id).length };
  const kept = summary.in_cents > 0 ? Math.max(0, Math.round((summary.left_cents / summary.in_cents) * 100)) : null;
  const spent = summary.in_cents > 0 ? Math.min(100, (summary.out_cents / summary.in_cents) * 100) : summary.out_cents > 0 ? 100 : 0;
  const monthName = MONTHS[Number(monthKey.slice(5, 7)) - 1];

  async function removeExpense(e: Expense) {
    if (!window.confirm(`Delete "${e.name}"?\n\n${cents(e.amount_cents)} on ${monDay(e.spent_on)}.`)) return;
    try { await moneyWrite(`/api/hub/expenses/${e.id}`, "DELETE"); hubToast(`Expense deleted · ${cents(e.amount_cents)}`); } catch (error) { hubToast(errorText(error)); }
  }
  async function cancelSub(s: Subscription) {
    if (!window.confirm(`Cancel ${s.name}?\n\nIt stops adding itself from today. What you already paid stays in your expenses.`)) return;
    try { await moneyWrite(`/api/hub/subscriptions/${s.id}`, "PATCH", { canceled: true }); hubToast(`${s.name} canceled`); } catch (error) { hubToast(errorText(error)); }
  }

  return (
    <div className="money-sections">
      <div className="money-divider"><span>Money in &amp; out</span></div>

      <div className="card money-card">
        <div className="money-head">
          <div><span className="eyebrow">Your money · {summary.label}</span><h3>What came in, minus what went out</h3></div>
          <div className="seg"><button className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>This month</button><button className={period === "year" ? "on" : ""} onClick={() => setPeriod("year")}>This year</button></div>
        </div>
        <div className="money-tiles">
          <div className="money-tile in"><span className="mt-icon"><ArrowDownLeft /></span><b>Money in</b><strong>{cents(summary.in_cents)}</strong>
            <small>{summary.counts.payments} payment{summary.counts.payments === 1 ? "" : "s"}{summary.counts.from_retainers ? ` · ${summary.counts.from_retainers} from retainers` : ""}</small>
            {summary.expected_in_cents ? <small className="in-ink">+ {cents(summary.expected_in_cents)} more expected by {monDay(summary.to)}</small> : null}</div>
          <div className="money-tile out"><span className="mt-icon"><ArrowUpRight /></span><b>Money out</b><strong>{cents(summary.out_cents)}</strong>
            <small>{summary.counts.expenses} expense{summary.counts.expenses === 1 ? "" : "s"}</small>
            {summary.to_renew_cents ? <small>+ {cents(summary.to_renew_cents)} still to renew</small> : null}</div>
          <div className="money-tile left"><span className="mt-icon"><PiggyBank /></span><b>What's left</b><strong>{cents(summary.left_cents)}</strong>
            <small>What came in, minus what went out</small>
            {kept !== null ? <small className="left-ink">You kept {kept}¢ of every dollar</small> : null}</div>
        </div>
        <div className="money-bar"><span style={{ width: `${100 - spent}%` }} /><i style={{ width: `${spent}%` }} /></div>
        <div className="money-bar-foot faint">
          <span><i className="k left" />Kept <i className="k out" />Spent</span>
          {period === "month" ? <span>This year so far: In {cents(money.year.in_cents)} · Out {cents(money.year.out_cents)} · Left {cents(money.year.left_cents)}</span> : null}
        </div>
      </div>

      <div className="money-pair">
        <div className="card money-card">
          <div className="money-head"><div><span className="eyebrow">Money out</span><h3>Expenses</h3></div>
            <button className="btn honey" onClick={() => setEditing({ kind: "expense" })}><Plus />Add expense</button></div>
          <div className="chip-row">
            {([["all", "All"], ["one_time", "One-off"], ["subscription", "Subscriptions"]] as const).map(([key, label]) =>
              <button key={key} className={`chip ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>{label} {counts[key]}</button>)}
            <button className="link" onClick={() => setWholeYear(!wholeYear)}>{wholeYear ? `Show ${monthName} only` : `Show all of ${year}`}</button>
          </div>
          {listed.length ? (
            <div className="money-rows">
              {listed.map((e) => (
                <div key={e.id} className="money-row" role="button" tabIndex={0} onClick={() => setEditing({ kind: "expense", expense: e })}>
                  <CategoryTile category={e.category} />
                  {/* Name first: the date sits under it and Delete under the amount, so a narrow card never squeezes the name. */}
                  <span className="mr-main"><b title={e.name}>{e.name}</b><small className="faint">{categoryOf(e.category).short} · {monDay(e.spent_on)}{e.subscription_id ? " · subscription" : ""}{e.deal_brand_name ? <span className="tag-s"><Link2 />for {e.deal_brand_name}</span> : null}</small></span>
                  <span className="mr-side">
                    <b className="mr-amt">−{cents(e.amount_cents)}</b>
                    <button className="link" onClick={(ev) => { ev.stopPropagation(); void removeExpense(e); }}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="faint money-empty">No expenses yet. Add what you pay your editor, your VA or your apps, and we'll keep the totals for tax time.</p>}
          {listed.length ? <div className="money-total"><span>Total out in {wholeYear ? year : monthName}</span><b>−{cents(listed.reduce((t, e) => t + e.amount_cents, 0))}</b></div> : null}
        </div>

        <div className="card money-card subs">
          <div className="money-head"><div><span className="eyebrow">They repeat on their own each month</span><h3>Subscriptions</h3></div></div>
          <div className="subs-total"><strong>{cents(subs?.monthly_cents ?? 0)} a month</strong><small>That's {cents(subs?.yearly_cents ?? 0)} a year</small></div>
          {subs?.subscriptions.length ? (
            <div className="money-rows">
              {subs.subscriptions.map((s) => {
                const soon = s.next_renewal_on && daysBetween(localToday(), s.next_renewal_on) <= 14;
                return (
                  <div key={s.id} className="money-row" role="button" tabIndex={0} onClick={() => setEditing({ kind: "subscription", subscription: s })}>
                    <span className={`cat-tile letter s-${categoryOf(s.category).stage}`}>{s.name.trim().charAt(0).toUpperCase()}</span>
                    <span className="mr-main"><b>{s.name}</b><small className={soon ? "soon" : "faint"}>{s.canceled_on ? `Canceled ${monDay(s.canceled_on)}` : s.next_renewal_on ? `Renews ${monDay(s.next_renewal_on)}` : ""}</small></span>
                    <b className="mr-amt">{cents(s.amount_cents)}</b>
                    {!s.canceled_on ? <button className="link" onClick={(ev) => { ev.stopPropagation(); void cancelSub(s); }}>Cancel</button> : null}
                  </div>
                );
              })}
            </div>
          ) : <p className="faint money-empty">Add the apps you pay for every month (Claude, CapCut, Canva…) and they'll add themselves.</p>}
          <button className="btn lg" onClick={() => setEditing({ kind: "subscription" })}><Plus />Add subscription</button>
        </div>
      </div>

      <TaxTime thisYear={money.year} />

      {editing?.kind === "expense" ? <ExpenseForm expense={editing.expense} onSwitch={() => setEditing({ kind: "subscription" })} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "subscription" ? <SubscriptionForm subscription={editing.subscription} onSwitch={() => setEditing({ kind: "expense" })} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function TaxTime({ thisYear }: { thisYear: MoneySummary }) {
  const current = Number(localToday().slice(0, 4));
  const [year, setYear] = useState(current);
  const earlier = useQuery({
    queryKey: ["hub", "money", "year", year],
    enabled: year !== current,
    queryFn: async () => (await api<{ summary: MoneySummary }>(withTz(`/api/hub/money?period=year&year=${year}`))).summary,
  }).data;
  const summary = year === current ? thisYear : earlier;
  const biggest = Math.max(1, ...(summary?.by_category.map((r) => r.cents) ?? [1]));
  const [saving, setSaving] = useState(false);

  async function exportFile() {
    setSaving(true);
    try {
      // As Export does: the site's own path, saved through the signed-in session.
      const result = await ch.files.save(withTz(`/api/hub/export?scope=year&year=${year}&format=xlsx&expenses=1`), `CreatorHive ${year} for my accountant.xlsx`);
      if (!result.ok) hubToast("The file wasn't saved. Try again.");
    } catch (error) {
      hubToast(`The file wasn't saved: ${errorText(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card money-card tax">
      <div className="tax-main">
        <div className="money-head">
          <div><span className="eyebrow">Tax time</span><h3>{year} expenses by category</h3><span className="faint">A clean summary to hand to your accountant</span></div>
          <select className="field year-pick" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[current, current - 1, current - 2].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        {summary?.by_category.length ? summary.by_category.map((r) => (
          <div key={r.category} className="tax-row">
            <CategoryTile category={r.category} size={32} />
            <span className="mr-main"><b>{categoryOf(r.category).label}</b><small className="faint">{r.count} expense{r.count === 1 ? "" : "s"}</small></span>
            <b className="mr-amt">{cents(r.cents)}</b>
            <span className={`tax-bar s-${categoryOf(r.category).stage}`}><i style={{ width: `${(r.cents / biggest) * 100}%` }} /></span>
          </div>
        )) : <p className="faint money-empty">No expenses in {year} yet.</p>}
        <div className="money-total"><span>Total expenses {year}</span><b>{cents(summary?.out_cents ?? 0)}</b></div>
      </div>
      <div className="tax-side">
        <span className="eyebrow">{year === current ? `${year} so far` : year}</span>
        <div className="tax-figs">
          <div><span>Money in</span><b>{cents(summary?.in_cents ?? 0)}</b></div>
          <div><span>Money out</span><b>{cents(summary?.out_cents ?? 0)}</b></div>
          <div><span>What's left</span><b>{cents(summary?.left_cents ?? 0)}</b></div>
        </div>
        <button className="btn honey lg" disabled={saving} onClick={() => void exportFile()}>{saving ? <Loader2 className="spin" /> : <FileDown />}Export for my accountant</button>
        <small className="faint">An Excel file: your {year} deals, money in and out by month, expenses by category, every expense and every payment.</small>
        <small className="faint">CreatorHive isn't an accountant. This is a summary of what you entered.</small>
      </div>
    </div>
  );
}

function KindSeg({ value, onSwitch }: { value: "one_time" | "monthly"; onSwitch: () => void }) {
  return <div className="seg"><button className={value === "one_time" ? "on" : ""} onClick={value === "one_time" ? undefined : onSwitch}>One time</button><button className={value === "monthly" ? "on" : ""} onClick={value === "monthly" ? undefined : onSwitch}>Every month</button></div>;
}

function CategoryChips({ value, onChange }: { value: ExpenseCategory; onChange: (c: ExpenseCategory) => void }) {
  return <div className="chip-row">{EXPENSE_CATEGORIES.map((c) => { const Icon = ICONS[c.id]; return <button key={c.id} type="button" className={`chip cat-chip s-${c.stage} ${value === c.id ? "on" : ""}`} onClick={() => onChange(c.id)}><Icon />{c.short}</button>; })}</div>;
}

const LAST_CATEGORY = "ch.hub.lastExpenseCategory";

function ExpenseForm({ expense, onSwitch, onClose }: { expense?: Expense; onSwitch: () => void; onClose: () => void }) {
  const deals = allDeals(useDeals().data).slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [amount, setAmount] = useState(expense ? (expense.amount_cents / 100).toFixed(2) : "");
  const [name, setName] = useState(expense?.name ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(() => expense?.category ?? ((localStorage.getItem(LAST_CATEGORY) as ExpenseCategory) || "other"));
  const [spentOn, setSpentOn] = useState(expense?.spent_on ?? localToday());
  const [dealId, setDealId] = useState(expense?.deal_id ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const value = parseAmount(amount);
    if (!value) { setError("Type the amount, like 180 or 31.99."); return; }
    if (!name.trim()) { setError("Say what it was for, like \"Maria R. · video editing\"."); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), amount_cents: value, category, spent_on: spentOn, deal_id: dealId || null, note: note.trim() || null };
      await moneyWrite(expense ? `/api/hub/expenses/${expense.id}` : "/api/hub/expenses", expense ? "PATCH" : "POST", body);
      try { localStorage.setItem(LAST_CATEGORY, category); } catch { /* fine */ }
      hubToast(expense ? "Expense saved" : `Expense added · −${cents(value)}`);
      onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  }

  return (
    <Modal title={expense ? "Edit expense" : "Add an expense"} onClose={onClose} width={500}
      foot={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : null}{expense ? "Save" : "Save expense"}</button></>}>
      <div className="form-col money-form">
        {!expense ? <KindSeg value="one_time" onSwitch={onSwitch} /> : null}
        <label><span>Amount</span><span className="big-amount"><i>$</i><input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></span></label>
        <label><span>What was it for?</span><input className="field" value={name} maxLength={160} placeholder="Maria R. · video editing" onChange={(e) => setName(e.target.value)} /></label>
        <div><span>Category</span><CategoryChips value={category} onChange={setCategory} /></div>
        <div className="form-2">
          <label><span>Date</span><input className="field" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} /></label>
          <label><span>For a deal? (optional)</span><select className="field" value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">No deal</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.brand_name}</option>)}</select></label>
        </div>
        <label><span>Note (optional)</span><input className="field" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}

function SubscriptionForm({ subscription, onSwitch, onClose }: { subscription?: Subscription; onSwitch: () => void; onClose: () => void }) {
  const today = localToday();
  const [amount, setAmount] = useState(subscription ? (subscription.amount_cents / 100).toFixed(2) : "");
  const [name, setName] = useState(subscription?.name ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(subscription?.category ?? "software");
  const [renewsDay, setRenewsDay] = useState(subscription?.renews_day ?? Number(today.slice(8, 10)));
  const [remind, setRemind] = useState(subscription?.remind_day_before ?? true);
  const [paidToday, setPaidToday] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const passed = !subscription && renewsDay < Number(today.slice(8, 10));

  async function save() {
    const value = parseAmount(amount);
    if (!value) { setError("Type the amount, like 9.99."); return; }
    if (!name.trim()) { setError("Name it, like CapCut or Canva."); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), amount_cents: value, category, renews_day: renewsDay, remind_day_before: remind, ...(subscription ? {} : { paid_today: paidToday }) };
      await moneyWrite(subscription ? `/api/hub/subscriptions/${subscription.id}` : "/api/hub/subscriptions", subscription ? "PATCH" : "POST", body);
      hubToast(subscription ? "Subscription saved" : `${name.trim()} added · ${cents(value)} a month`);
      onClose();
    } catch (e) { setError(errorText(e)); setBusy(false); }
  }

  return (
    <Modal title={subscription ? "Edit subscription" : "Add a subscription"} onClose={onClose} width={500}
      foot={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : null}Save</button></>}>
      <div className="form-col money-form">
        {!subscription ? <KindSeg value="monthly" onSwitch={onSwitch} /> : null}
        <label><span>Name</span><input className="field" autoFocus value={name} maxLength={120} placeholder="CapCut" onChange={(e) => setName(e.target.value)} /></label>
        <label><span>Amount</span><span className="big-amount"><i>$</i><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /><em>a month</em></span></label>
        <label><span>Renews on</span><select className="field" value={renewsDay} onChange={(e) => setRenewsDay(Number(e.target.value))}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>The {ordinal(d)} of each month{d > 28 ? " (or the last day)" : ""}</option>)}</select></label>
        <div><span>Category</span><CategoryChips value={category} onChange={setCategory} /></div>
        <label className="check-row"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /><span><b>Remind me the day before</b><small className="faint">So nothing renews by surprise</small></span></label>
        {passed ? <label className="check-row"><input type="checkbox" checked={paidToday} onChange={(e) => setPaidToday(e.target.checked)} /><span><b>Already paid this month?</b><small className="faint">Adds today's charge now. Otherwise the first one is next month.</small></span></label> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
