import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, keys, queryClient } from "../../lib/api";
import { refreshHs } from "../../lib/heysocial";
import { channelName } from "../../lib/ui";
import { Modal } from "../hub/parts";
import "../../styles/admin-heysocial.css";

/*
  Renaming and leaving a Hey Social Inc. channel from its sidebar menu, as the
  website's sidebar does: Rename for full members (the server checks they're
  in the channel), Leave for everyone.
*/

export function RenameChannel({ channel, onClose }: { channel: { id: string; name: string }; onClose: () => void }) {
  const [name, setName] = useState(channelName(channel.name));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { name: name.trim() } });
      void queryClient.invalidateQueries({ queryKey: keys.channels("heysocial") });
      await refreshHs();
      onClose();
    } catch (e) {
      const text = (e as Error).message;
      setError(text && !text.startsWith("HTTP") && text !== "not found" ? text : "The channel couldn't be renamed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Rename channel" onClose={onClose} width={440}
      foot={<>{error ? <span className="form-error">{error}</span> : null}<button className="btn" onClick={onClose}>Cancel</button><button className="btn honey" disabled={!name.trim() || saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" /> : null}Save</button></>}>
      <p className="hsc-lede">Everyone in the channel sees the new name. Links to it keep working.</p>
      <label className="flabel" htmlFor="hs-channel-new-name">Name</label>
      <input id="hs-channel-new-name" className="field hsc-field" autoFocus maxLength={50} value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
    </Modal>
  );
}

/** "Leave #name?" with the website's words. True once they've left. */
export async function leaveChannel(channel: { id: string; name: string; workspaceOpen?: boolean }) {
  const open = channel.workspaceOpen;
  if (!window.confirm(`Leave #${channelName(channel.name)}?\n\n${open ? "You can join again any time from Browse channels." : "It's private: someone in it will have to add you back."}`)) return false;
  try {
    await api(`/api/channels/${channel.id}/members`, { method: "DELETE" });
  } catch {
    window.alert("You couldn't leave that channel. Try again.");
    return false;
  }
  void queryClient.invalidateQueries({ queryKey: keys.channels("heysocial") });
  void refreshHs();
  return true;
}
