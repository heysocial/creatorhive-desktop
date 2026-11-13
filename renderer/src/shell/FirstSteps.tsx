import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Camera, Check } from "lucide-react";
import { api, ApiError, PASSWORD_REQUIRED_EVENT, queryClient } from "../lib/api";
import { ch, type SessionUser } from "../lib/bridge";
import { ME_ACCESS_KEY, useMeAccess } from "../lib/access";
import { Avatar } from "../lib/ui";

/*
  The Weekend Starter's simpler sign-up (creatorhive-app docs/weekend-signup.md).
  A new buyer signs in with the temporary password from the email; before
  anything else opens they choose their own ("Create your password", no way
  around it but Sign out), then the profile step (photo, gender, bio), then Home.
  GET /api/me/access says which step is due, after sign-in and on every launch;
  any request refused with PASSWORD_CHANGE_REQUIRED brings the first step back.
*/

type Step = "loading" | "password" | "profile" | "done";

export function FirstSteps({ user, onUser, children }: { user: SessionUser; onUser: (patch: Partial<SessionUser>) => void; children: ReactNode }) {
  const me = useMeAccess();
  const [forced, setForced] = useState(false);
  useEffect(() => {
    const required = () => {
      setForced(true);
      void queryClient.invalidateQueries({ queryKey: ME_ACCESS_KEY });
    };
    window.addEventListener(PASSWORD_REQUIRED_EVENT, required);
    return () => window.removeEventListener(PASSWORD_REQUIRED_EVENT, required);
  }, []);

  // Until the answer is in, nothing of the app shows (it would only be refused); a failed read lets the app open, as before.
  const step: Step = forced || me.data?.mustChangePassword ? "password"
    : me.data?.welcomePending ? "profile"
    : me.isPending ? "loading" : "done";

  async function next() {
    setForced(false);
    await queryClient.invalidateQueries({ queryKey: ME_ACCESS_KEY });
  }

  if (step === "loading") return <div className="signin" />;
  if (step === "password") return <CreatePassword email={user.email} onDone={() => void next()} />;
  if (step === "profile") return <Welcome user={user} onUser={onUser} onDone={() => void next()} />;
  return <>{children}</>;
}

/* ---------- Create your password ---------- */

type Problem = { field: "password" | "confirm" | null; text: string } | null;

function CreatePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Problem>(null);

  // The same checks and words as the server, before asking it.
  function check(): Problem {
    if (!password) return { field: "password", text: "Type your new password." };
    if (password.length < 8) return { field: "password", text: "Use at least 8 characters." };
    if (!confirm) return { field: "confirm", text: "Type your new password a second time." };
    if (password !== confirm) return { field: "confirm", text: "The two passwords don’t match. Type them again." };
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = check();
    setError(problem);
    if (problem || saving) return;
    setSaving(true);
    const result = await ch.api<{ ok?: boolean; code?: string; error?: string; next?: string }>({ method: "POST", path: "/api/account/first-password", body: { password, confirm } });
    setSaving(false);
    const body = result.data;
    if (result.ok && body?.ok) { onDone(); return; }
    const code = String(body?.code ?? "");
    // Already chosen (another device, another window): on to the next step.
    if (code === "ALREADY_SET" || result.status === 409) { onDone(); return; }
    if (!result.status) { setError({ field: null, text: "Your password couldn’t be saved. Check your connection and try again." }); return; }
    setError({ field: code === "MISMATCH" || code === "CONFIRM_EMPTY" ? "confirm" : "password", text: body?.error ?? "Your password couldn’t be saved. Try again." });
  }

  const site = (path: string) => ch.app.openSite(path);
  return (
    <div className="signin first-steps">
      <div className="signin-card">
        <div className="mark"><img src="./ch-logo.svg" alt="" /></div>
        <h1>Create your password</h1>
        <p>Choose a password you’ll remember. You’ll use it from now on, instead of the temporary one from the email.</p>
        <form className="signin-form fs-form" onSubmit={(event) => void submit(event)} noValidate>
          {email ? <p className="fs-login">Your login: <b>{email}</b></p> : null}
          <label htmlFor="new-password">New password</label>
          <input id="new-password" className="field" type={show ? "text" : "password"} autoComplete="new-password" autoFocus value={password}
            aria-invalid={error?.field === "password" || undefined} aria-describedby="new-password-help"
            onChange={(event) => { setPassword(event.target.value); setError(null); }} />
          <small id="new-password-help" className="fs-hint">At least 8 characters.</small>
          <label htmlFor="confirm-password">Type it again</label>
          <input id="confirm-password" className="field" type={show ? "text" : "password"} autoComplete="new-password" value={confirm}
            aria-invalid={error?.field === "confirm" || undefined}
            onChange={(event) => { setConfirm(event.target.value); setError(null); }} />
          <label className="fs-show">
            <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />
            Show passwords
          </label>
          {error ? <div className="signin-error" role="alert">{error.text}</div> : null}
          <button type="submit" className="btn honey lg" disabled={saving}>{saving ? "Saving…" : "Save my password"}</button>
          <p className="fs-terms">
            By continuing you agree to the <button type="button" onClick={() => site("/terms")}>Terms of Service</button> and <button type="button" onClick={() => site("/privacy")}>Privacy Policy</button>.
          </p>
        </form>
        <p className="signin-foot">Not you? <button type="button" className="fs-link" onClick={() => void ch.auth.signOut()}>Sign out</button></p>
      </div>
    </div>
  );
}

/* ---------- Complete your profile ---------- */

type Gender = "male" | "female" | "unspecified";
const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unspecified", label: "Prefer not to say" },
];
const BIO_MAX = 160;
const PHOTO_NEEDED = "Show us that face! Add a photo so the hive knows who you are.";

interface Profile { name: string; avatarUrl: string | null; bio: string | null; gender: Gender | null }

function Welcome({ user, onUser, onDone }: { user: SessionUser; onUser: (patch: Partial<SessionUser>) => void; onDone: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [bio, setBio] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoPrompt, setPhotoPrompt] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ profile: Profile }>("/api/profile").then(({ profile: p }) => {
      setProfile(p);
      setGender(p.gender);
      setBio(p.bio ?? "");
    }).catch(() => setError("Your profile couldn't be loaded. Check your connection."));
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(next: File | undefined) {
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) { setError("Pick a JPEG, PNG, or WebP photo."); return; }
    if (next.size > 3 * 1024 * 1024) { setError("That photo is over 3 MB. Pick a smaller one."); return; }
    setError(null);
    setPhotoPrompt(false);
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  async function save() {
    if (saving) return;
    const current = profile?.avatarUrl ?? user.image ?? null;
    if (!file && !current) { setPhotoPrompt(true); return; }
    setSaving(true);
    setError(null);
    try {
      let avatarUrl = current;
      if (file) {
        const upload = await ch.files.uploadForm({ path: "/api/profile/avatar", field: "file", name: file.name, type: file.type, bytes: await file.arrayBuffer() });
        if (!upload.ok) throw new Error(upload.error === "avatar_file_too_large" ? "That photo is over 3 MB. Pick a smaller one." : "Your photo couldn't be uploaded. Try again.");
        avatarUrl = (upload.data as { avatarUrl?: string } | undefined)?.avatarUrl ?? avatarUrl;
      }
      await api("/api/profile", { method: "PATCH", body: { gender, bio } });
      // The profile step is done: Home next.
      await api("/api/me/welcome", { method: "POST" }).catch(() => undefined);
      if (avatarUrl !== user.image) onUser({ image: avatarUrl });
      onDone();
    } catch (caught) {
      const field = caught instanceof ApiError && caught.data?.fieldErrors ? Object.values(caught.data.fieldErrors as Record<string, string>)[0] : null;
      setError(field ?? (caught instanceof Error && !(caught instanceof ApiError) ? caught.message : "Your profile couldn't be saved. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const name = profile?.name || user.name || "Creator";
  const avatar = preview ?? profile?.avatarUrl ?? user.image ?? null;
  const bioLength = [...bio].length;
  return (
    <div className="signin first-steps">
      <div className="signin-card fs-wide">
        <div className="mark"><img src="./ch-logo.svg" alt="" /></div>
        <span className="fs-eyebrow">One last step</span>
        <h1>Complete your profile</h1>
        <p>Add a photo so the hive can recognize you. The rest is up to you.</p>
        <div className="signin-form fs-form">
          <div className={`fs-photo ${photoPrompt ? "needs" : ""}`}>
            <Avatar name={name} src={avatar} size={88} seed={user.id} />
            <div>
              <button type="button" className="btn lg" onClick={() => picker.current?.click()} disabled={saving}><Camera />{file ? "Change photo" : "Upload photo"}</button>
              <small className="fs-hint">Required · JPEG, PNG, or WebP · max 3MB</small>
            </div>
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          {photoPrompt ? <div className="signin-error" role="alert">{PHOTO_NEEDED}</div> : null}
          <fieldset className="fs-gender" disabled={saving}>
            <legend>Gender</legend>
            <small className="fs-hint">So we can celebrate you as a King or Queen Bee 🐝</small>
            <div>
              {GENDERS.map((option) => (
                <button key={option.value} type="button" className={`chip ${gender === option.value ? "on" : ""}`} aria-pressed={gender === option.value} onClick={() => setGender(option.value)}>
                  {gender === option.value ? <Check /> : null}{option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label htmlFor="welcome-bio">Short bio <span className="fs-optional">Optional</span></label>
          <textarea id="welcome-bio" className="field area" rows={3} maxLength={BIO_MAX} disabled={saving} value={bio}
            placeholder="UGC creator, storyteller, and matcha enthusiast." onChange={(event) => setBio(event.target.value)} />
          <small className="fs-hint fs-count">{bioLength}/{BIO_MAX}</small>
          {error ? <div className="signin-error" role="alert">{error}</div> : null}
          <button type="button" className="btn honey lg" disabled={saving || !profile || bioLength > BIO_MAX} onClick={() => void save()}>
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
        <p className="signin-foot">Not you? <button type="button" className="fs-link" onClick={() => void ch.auth.signOut()}>Sign out</button></p>
      </div>
    </div>
  );
}
