import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ch, type SessionUser } from "./lib/bridge";
import { queryClient, useHeySocialAccess } from "./lib/api";
import { commands, type Command } from "./lib/commands";
import { openPath } from "./lib/links";
import { nav, useNav } from "./lib/nav";
import { useRealtimeRefresh } from "./lib/realtime";
import { SignIn } from "./signin/SignIn";
import { TopBar } from "./shell/TopBar";
import { UpdateBanner } from "./shell/UpdateBanner";
import { Rail } from "./shell/Rail";
import { SidebarResizer, useSidebarLayout } from "./shell/SidebarResizer";
import { Sidebar } from "./sidebars/Sidebars";
import { Main } from "./views/Main";
import { QuickSwitcher } from "./overlays/QuickSwitcher";
import { ShortcutsSheet } from "./overlays/Sheets";
import { NewMessage } from "./overlays/NewMessage";
import { HubDialogs, hubToast } from "./views/hub/parts";
import { DealFormHost, openDealForm } from "./views/hub/DealForm";
import { ExportHost, openExport } from "./views/hub/Export";
import { PromptHost } from "./views/hub/DealPanel";
import { STATUS_LABELS, type DealStatus } from "./lib/hub";
import { BrowseChannels, CreateChannel } from "./views/heysocial/Lists";
import { DEFAULT_THEME, refreshHs, themeCss, useHsSidebar } from "./lib/heysocial";
import { api } from "./lib/api";
import { usePresence } from "./lib/realtime";
import { SupportWidget } from "./shell/Support";

type Auth = { state: "loading" } | { state: "offline" } | { state: "signedOut" } | { state: "signedIn"; user: SessionUser };
type Overlay = null | "quick-open" | "shortcuts" | "new-message";

/* ⌥↑/⌥↓ walk the sidebar; with ⇧ they skip to the next unread item. */
function moveInSidebar(direction: 1 | -1, unreadOnly: boolean) {
  const items = [...document.querySelectorAll<HTMLElement>(".sidebar [data-nav]")];
  if (items.length === 0) return;
  const current = items.findIndex((item) => item.getAttribute("aria-current") === "page" || item.classList.contains("on"));
  for (let step = 1; step <= items.length; step += 1) {
    const index = (current + direction * step + items.length) % items.length;
    const item = items[index];
    if (unreadOnly && !item.dataset.unread) continue;
    item.click();
    item.scrollIntoView({ block: "nearest" });
    return;
  }
}

/**
 * Touch ID is on and the Mac was locked, slept or just started: nothing shows until you unlock.
 * When Touch ID doesn't work (wrong finger, lid closed, too many tries) your CreatorHive
 * password opens it too, and Sign out is always there as the way out.
 */
export function LockScreen() {
  const [failed, setFailed] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const failedRef = useRef(false);
  const unlock = useCallback(async () => {
    const ok = await ch.app.unlock();
    failedRef.current = !ok;
    setFailed(!ok);
  }, []);
  useEffect(() => {
    void unlock();
    // Coming back to the window asks again, but not after a failure: the password is the next step then.
    return ch.window.onFocus((focused) => { if (focused && !failedRef.current) void unlock(); });
  }, [unlock]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const result = await ch.app.unlockWithPassword(password);
    setBusy(false);
    if (result.ok) return;
    setPassword("");
    setError(
      result.error === "offline" ? "Can't check your password while offline. Try Touch ID or check your connection."
      : result.error === "no_password" ? "Your account signs in with Google or Apple, so it has no password. Use Touch ID."
      : result.error === "too_many_attempts" ? "Too many attempts. Try again in a few minutes or reset your password."
      : "That password isn't right. Try again.",
    );
  };
  return (
    <div className="lock-screen">
      <img src="./ch-logo.svg" alt="" />
      <h2>CreatorHive is locked</h2>
      {usePassword ? (
        <form className="lock-form" onSubmit={(event) => void submit(event)}>
          <p className="muted">Enter your CreatorHive password to unlock.</p>
          <input className="field" type="password" autoComplete="current-password" autoFocus aria-label="Password" placeholder="Password"
            value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} />
          {error ? <div className="signin-error" role="alert">{error}</div> : null}
          <button type="submit" className="btn honey lg" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</button>
          <button type="button" className="btn lg" onClick={() => { setUsePassword(false); setError(null); void unlock(); }}>Use Touch ID</button>
        </form>
      ) : (
        <>
          <p className="muted">{failed ? "Touch ID didn't unlock it. Try again, or use your password." : "Use Touch ID to open it."}</p>
          <button className="btn honey lg" onClick={() => void unlock()}>Unlock with Touch ID</button>
          <button className="btn lg" onClick={() => setUsePassword(true)}>Use password</button>
        </>
      )}
      <button className="lock-signout" onClick={() => void ch.auth.signOut()}>Sign out</button>
    </div>
  );
}

/*
  Opened with no connection (at login before Wi-Fi is up, on a plane): the
  saved session can't be checked, which isn't the same as signed out. Keep
  asking until the server answers; only a real "signed out" shows sign-in.
*/
function Offline({ onSession }: { onSession: (user: SessionUser | null) => void }) {
  const [checking, setChecking] = useState(false);
  const retry = useCallback(async () => {
    setChecking(true);
    const { user, offline } = await ch.auth.session();
    setChecking(false);
    if (!offline) onSession(user);
  }, [onSession]);
  useEffect(() => {
    const timer = setInterval(() => void retry(), 5000);
    const online = () => void retry();
    window.addEventListener("online", online);
    const offFocus = ch.window.onFocus((focused) => { if (focused) void retry(); });
    return () => { clearInterval(timer); window.removeEventListener("online", online); offFocus(); };
  }, [retry]);
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="mark"><img src="./ch-logo.svg" alt="" /></div>
        <h1>Can't reach CreatorHive</h1>
        <p>You're still signed in. CreatorHive opens on its own as soon as your Mac is back online.</p>
        <button className="btn honey lg" style={{ marginTop: 10 }} disabled={checking} onClick={() => void retry()}>{checking ? "Connecting…" : "Try again"}</button>
      </div>
    </div>
  );
}

function Workspace({ user, info }: { user: SessionUser; info: { version: string; preview: boolean; fullscreen: boolean } }) {
  const navState = useNav();
  useRealtimeRefresh(user.id);
  usePresence();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const sidebar = useSidebarLayout();
  const [fullscreen, setFullscreen] = useState(info.fullscreen);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hsDialog, setHsDialog] = useState<null | "create" | "browse">(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    void ch.app.isLocked().then(setLocked);
    return ch.app.onLocked(setLocked);
  }, []);
  useEffect(() => {
    const create = () => setHsDialog("create");
    const browse = () => setHsDialog("browse");
    window.addEventListener("ch:hs-create-channel", create);
    window.addEventListener("ch:hs-browse", browse);
    return () => { window.removeEventListener("ch:hs-create-channel", create); window.removeEventListener("ch:hs-browse", browse); };
  }, []);
  const heySocial = useHeySocialAccess().data === true;
  // Your Hey Social Inc. theme colours the top bar, rail and sidebar while you're in it, as on the website.
  const hsTheme = useHsSidebar(heySocial).data?.theme;
  const themed = heySocial && navState.current.ws === "hs" && hsTheme && hsTheme !== DEFAULT_THEME ? hsTheme : undefined;
  const themeStyle = useMemo(() => themeCss(themed), [themed]);
  // Picked in the Settings window, which has its own cache.
  useEffect(() => ch.app.onRelay((message) => { if (message.topic === "hey-social" && message.action === "settings") void refreshHs(); }), []);

  useEffect(() => ch.app.setHeySocialAccess(heySocial), [heySocial]);
  useEffect(() => ch.window.onFullscreen(setFullscreen), []);
  // Downloaded before this window was showing the workspace? Ask, as well as listening.
  useEffect(() => {
    void ch.app.updateStatus().then((version) => { if (version) setUpdateReady(version); });
    return ch.app.onUpdateReady(setUpdateReady);
  }, []);
  const [updateLater, setUpdateLater] = useState(false);
  useEffect(() => ch.app.onNavigate((path) => openPath(path)), []);
  // From a pop-out: "dm:<id>", "channel:<id>", "profile:<id>".
  useEffect(() => ch.app.onNavigateView((target) => {
    // Settings → Help → Open chat.
    if (target === "support") return void window.dispatchEvent(new Event("ch:support-open"));
    const [kind, id] = target.split(":");
    if (!id) return;
    if (kind === "profile") nav.open({ kind: "profile", id });
    if (kind === "dm" || kind === "channel") nav.open({ kind, id }, nav.get().section === "dms" ? "dms" : "home");
  }), []);
  // A partner's change to the Shared Hub, said once, as the website does.
  useEffect(() => ch.realtime.onMessage((message) => {
    if (message.channel !== `user:${user.id}` || message.name !== "hub:changed") return;
    const data = message.data as { by?: { id: string; name: string }; action?: string; brandName?: string; toStatus?: DealStatus } | null;
    if (!data?.by || data.by.id === user.id || !data.brandName) return;
    const first = data.by.name.split(" ")[0];
    const text = data.action === "created" ? `${first} added ${data.brandName}` : data.action === "moved" && data.toStatus ? `${first} moved ${data.brandName} to ${STATUS_LABELS[data.toStatus]}`
      : data.action === "deleted" ? `${first} deleted ${data.brandName}` : `${first} updated ${data.brandName}`;
    hubToast(text);
  }), [user.id]);
  // Opening the app counts for the day's streak, as on the website.
  useEffect(() => {
    void api("/api/points/daily-login", { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["points"] })).catch(() => {});
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = useCallback((command: Command) => {
    switch (command) {
      case "back": return nav.back();
      case "forward": return nav.forward();
      case "go:home": return nav.section("home");
      case "go:dms": return nav.section("dms");
      case "go:hub": return nav.section("hub", "ch");
      case "go:learn": return nav.section("learn", "ch");
      // CreatorHive: Activity opens in the main area beside the channel list, as its sidebar row does. Hey Social keeps its own section.
      case "go:activity": return nav.get().ws === "hs" ? nav.section("activity") : nav.open({ kind: "activity" }, "home", "ch");
      case "workspace:ch": return nav.workspace("ch");
      case "workspace:hs": return heySocial ? nav.workspace("hs") : undefined;
      case "quick-open": return setOverlay((open) => (open === "quick-open" ? null : "quick-open"));
      case "shortcuts": return setOverlay("shortcuts");
      case "settings": return ch.window.popout({ kind: "settings", id: "main" });
      case "toggle-sidebar": return sidebar.toggle();
      case "new-message":
        return setOverlay("new-message");
      case "new-deal":
        nav.section("hub", "ch");
        return openDealForm({});
      case "export":
        return openExport();
      case "new-post":
        // In a lesson, ⇧⌘N notes the moment instead.
        if (nav.get().view.kind === "course") return void window.dispatchEvent(new Event("ch:lesson-note"));
        nav.open({ kind: "feed" }, "home", "ch");
        return void setTimeout(() => window.dispatchEvent(new Event("ch:new-post")), 50);
      case "popout": {
        const { view } = nav.get();
        if (view.kind === "dm" || view.kind === "channel") ch.window.popout({ kind: view.kind, id: view.id });
        return;
      }
      case "sign-out":
        return void ch.auth.signOut();
    }
  }, [heySocial]);

  useEffect(() => commands.on(run), [run]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (overlay) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        moveInSidebar(event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  const close = useCallback(() => setOverlay(null), []);
  return (
    <div className={`app ${sidebar.open ? "" : "no-sidebar"} ${sidebar.dragging ? "resizing" : ""} ${fullscreen ? "fullscreen" : ""}`}
      data-hs-theme={themed} style={{ "--sidebar-w": `${sidebar.open ? sidebar.width : 0}px` } as React.CSSProperties}>
      {themeStyle ? <style>{themeStyle}</style> : null}
      <TopBar preview={info.preview} sidebarOpen={sidebar.open} />
      <Rail user={user} />
      <Sidebar user={user} />
      <SidebarResizer layout={sidebar} />
      <Main user={user} />
      {overlay === "quick-open" ? <QuickSwitcher onClose={close} /> : null}
      {overlay === "shortcuts" ? <ShortcutsSheet onClose={close} /> : null}
      {overlay === "new-message" ? <NewMessage onClose={close} workspace={nav.get().ws === "hs" ? "heysocial" : "creatorhive"} /> : null}
      <SupportWidget />
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {updateReady && !updateLater ? <UpdateBanner version={updateReady} onLater={() => setUpdateLater(true)} /> : null}
      {locked ? <LockScreen /> : null}
      <HubDialogs />
      <DealFormHost />
      <ExportHost />
      <PromptHost />
      {hsDialog === "create" ? <CreateChannel onClose={() => setHsDialog(null)} /> : null}
      {hsDialog === "browse" ? <BrowseChannels onClose={() => setHsDialog(null)} /> : null}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: "loading" });
  const [info, setInfo] = useState({ version: "", preview: false, fullscreen: false });

  useEffect(() => {
    void ch.info().then(setInfo);
    void ch.auth.session().then(({ user, offline }) => setAuth(user ? { state: "signedIn", user } : offline ? { state: "offline" } : { state: "signedOut" }));
    // Menu commands arrive before or after sign-in; route them through one place.
    const offCommand = ch.app.onCommand((id) => commands.run(id as Command));
    const offAuth = ch.auth.onChanged(() => {
      queryClient.clear();
      nav.reset();
      setAuth({ state: "signedOut" });
    });
    // A profile saved in the Settings window: this window has its own cache, so read your profile again and show the new name or photo.
    const offProfile = ch.app.onRelay((message) => {
      if (message.topic !== "profile" || message.action !== "changed") return;
      const change = (message.data ?? {}) as { name?: string; image?: string | null };
      for (const key of ["profile", "my-profile", "members", "posts", "post", "comments"]) void queryClient.invalidateQueries({ queryKey: [key] });
      setAuth((current) => (current.state === "signedIn" ? { ...current, user: {
        ...current.user,
        ...(change.name ? { name: change.name } : {}),
        ...("image" in change ? { image: change.image } : {}),
      } } : current));
    });
    return () => {
      offCommand();
      offAuth();
      offProfile();
    };
  }, []);

  if (auth.state === "loading") return <div className="signin" />;
  if (auth.state === "offline") return <Offline onSession={(user) => setAuth(user ? { state: "signedIn", user } : { state: "signedOut" })} />;
  if (auth.state === "signedOut") return <SignIn onSignedIn={(user) => setAuth({ state: "signedIn", user })} />;
  return <Workspace key={auth.user.id} user={auth.user} info={info} />;
}
