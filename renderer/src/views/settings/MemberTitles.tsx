import { useEffect, useState } from "react";
import { BadgeCheck, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "../../lib/api";
import { Modal } from "../hub/parts";
import { TITLE_COLORS, TitleBadge, type MemberTitle, type TitleColorKey } from "../people/MembersAdmin";
import "../../styles/admin-members.css";

/*
  Settings → Member titles (the website's MemberTitlesSettings): the custom
  badges the owner can give a member in Manage badge. Owner only, here and in
  /api/settings/member-titles.
*/

const KEY = ["settings", "member-titles"] as const;

function titleErrorMessage(error: unknown) {
  if (error === "member_title_exists") return "A title with that name already exists.";
  if (error === "invalid_member_title") return "Use a title between 1 and 48 characters.";
  return "That title could not be saved. Please try again.";
}

const sortTitles = (titles: MemberTitle[]) => [...titles].sort((a, b) => a.name.localeCompare(b.name));

export function MemberTitles() {
  const titles = useQuery({ queryKey: KEY, queryFn: async () => (await api<{ titles: MemberTitle[] }>("/api/settings/member-titles")).titles });
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; title: MemberTitle | null } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = titles.data ?? [];

  async function removeTitle(title: MemberTitle) {
    const detail = title.assignedCount > 0
      ? `${title.assignedCount} ${title.assignedCount === 1 ? "member" : "members"} will return to their role or Bee tier badge.`
      : "This title will be permanently removed.";
    if (!window.confirm(`Delete “${title.name}”?\n\n${detail}`)) return;
    setDeletingId(title.id);
    setError(null);
    try {
      await api(`/api/settings/member-titles/${title.id}`, { method: "DELETE" });
      queryClient.setQueryData<MemberTitle[]>(KEY, (current) => current?.filter((item) => item.id !== title.id));
      // Members who had it show their role or Bee tier again.
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    } catch {
      setError("That title could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function saved(title: MemberTitle) {
    queryClient.setQueryData<MemberTitle[]>(KEY, (current = []) => sortTitles(current.some((item) => item.id === title.id) ? current.map((item) => item.id === title.id ? title : item) : [...current, title]));
    void queryClient.invalidateQueries({ queryKey: ["members"] });
    setEditor(null);
  }

  return (
    <section className="set-group">
      <h3>Create the single badge owners can assign to a member.</h3>
      <div className="set-card">
        <div className="mad-titles-bar">
          <div>
            <b>{list.length} {list.length === 1 ? "title" : "titles"}</b>
            <span>Titles replace role and Bee tier badges wherever a name appears.</span>
          </div>
          <button className="btn" onClick={() => setEditor({ mode: "create", title: null })}><Plus />Add title</button>
        </div>
        {titles.isLoading ? (
          <div className="mad-titles-wait"><Loader2 className="spin" /> Loading titles…</div>
        ) : titles.isError && list.length === 0 ? (
          <div className="mad-titles-empty">
            <b>Couldn’t load titles</b>
            <span>Member titles are unavailable right now.</span>
            <button className="link" onClick={() => void titles.refetch()}>Try again</button>
          </div>
        ) : list.length === 0 ? (
          <div className="mad-titles-empty">
            <BadgeCheck />
            <b>No custom titles yet</b>
            <span>Create one for coaches, specialists, or community leaders.</span>
          </div>
        ) : list.map((title) => (
          <div className="mad-title-row" key={title.id}>
            <div>
              <TitleBadge name={title.name} colorKey={title.colorKey} />
              <small>{title.assignedCount} {title.assignedCount === 1 ? "member" : "members"}{title.countsAsCoach ? " · Counts as a coach" : ""}</small>
            </div>
            <div className="mad-title-acts">
              <button className="iconbtn" aria-label={`Edit ${title.name}`} title="Edit" onClick={() => setEditor({ mode: "edit", title })}><Pencil /></button>
              <button className="iconbtn" aria-label={`Delete ${title.name}`} title="Delete" disabled={deletingId === title.id} onClick={() => void removeTitle(title)}>
                {deletingId === title.id ? <Loader2 className="spin" /> : <Trash2 />}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error ? <p className="set-note late-text" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
      {editor ? <TitleEditor editor={editor} onClose={() => setEditor(null)} onSaved={saved} /> : null}
    </section>
  );
}

function TitleEditor({ editor, onClose, onSaved }: { editor: { mode: "create" | "edit"; title: MemberTitle | null }; onClose: () => void; onSaved: (title: MemberTitle) => void }) {
  const [name, setName] = useState(editor.title?.name ?? "");
  const [countsAsCoach, setCountsAsCoach] = useState(editor.title?.countsAsCoach ?? false);
  const [colorKey, setColorKey] = useState<TitleColorKey>(editor.title?.colorKey ?? "teal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [editor]);

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ title: MemberTitle }>(editor.mode === "edit" ? `/api/settings/member-titles/${editor.title?.id}` : "/api/settings/member-titles", {
        method: editor.mode === "edit" ? "PATCH" : "POST",
        body: { name: name.trim(), countsAsCoach, colorKey },
      });
      onSaved(data.title);
    } catch (saveError) {
      setError(titleErrorMessage(saveError instanceof ApiError ? saveError.data?.error : undefined));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editor.mode === "edit" ? "Edit member title" : "Create member title"}
      onClose={() => !saving && onClose()}
      width={440}
      foot={<>
        <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn honey" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? <Loader2 className="spin" /> : null}{editor.mode === "edit" ? "Save changes" : "Create title"}</button>
      </>}
    >
      <div className="mad-dialog roomy">
        <p className="mad-desc">This becomes the member’s only badge throughout CreatorHive.</p>
        <label className="mad-field">
          <span>Title name</span>
          <input className="field" autoFocus value={name} maxLength={48} placeholder="Head Coach" onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} />
          <small className="mad-count-line">{name.length}/48</small>
        </label>
        <div className="mad-toggle">
          <span><b>Counts as a coach</b><small>Members with this title are included in the Home coach count.</small></span>
          <button role="switch" aria-checked={countsAsCoach} aria-label="Counts as a coach" className={`switch ${countsAsCoach ? "on" : ""}`} onClick={() => setCountsAsCoach(!countsAsCoach)}><i /></button>
        </div>
        <fieldset className="mad-colours">
          <legend>Badge colour</legend>
          <div className="mad-colour-grid">
            {TITLE_COLORS.map((color) => (
              <label key={color.key} title={color.label} className={colorKey === color.key ? "on" : undefined}>
                <input type="radio" name="member-title-color" value={color.key} checked={colorKey === color.key} onChange={() => setColorKey(color.key)} />
                <i style={{ background: color.hex }} aria-hidden />
                <small>{color.label}</small>
              </label>
            ))}
          </div>
          <div className="mad-colour-preview"><span>Preview</span><TitleBadge name={name.trim() || "Member title"} colorKey={colorKey} /></div>
        </fieldset>
        {error ? <p className="mad-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
