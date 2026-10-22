import { useCallback, useEffect, useState } from "react";
import { ch, type SessionUser } from "./lib/bridge";
import { queryClient, useHeySocialAccess } from "./lib/api";
import { commands, type Command } from "./lib/commands";
import { openPath } from "./lib/links";
import { nav, useNav } from "./lib/nav";
import { useRealtimeRefresh } from "./lib/realtime";
import { SignIn } from "./signin/SignIn";
import { TopBar } from "./shell/TopBar";
import { Rail } from "./shell/Rail";
import { Sidebar } from "./sidebars/Sidebars";
import { Main } from "./views/Main";
import { QuickSwitcher } from "./overlays/QuickSwitcher";
import { SettingsSheet, ShortcutsSheet } from "./overlays/Sheets";
import { NewMessage } from "./overlays/NewMessage";
import { HubDialogs, hubToast } from "./views/hub/parts";
import { DealFormHost, openDealForm } from "./views/hub/DealForm";
import { ExportHost, openExport } from "./views/hub/Export";
import { PromptHost } from "./views/hub/DealPanel";
import { STATUS_LABELS, type DealStatus } from "./lib/hub";
import { BrowseChannels, CreateChannel } from "./views/heysocial/Lists";
import { api } from "./lib/api";
import { usePresence } from "./lib/realtime";

type Auth = { state: "loading" } | { state: "signedOut" } | { state: "signedIn"; user: SessionUser };
type Overlay = null | "quick-open" | "shortcuts" | "settings" | "new-message";

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

function Workspace({ user, info }: { user: SessionUser; info: { version: string; preview: boolean; fullscreen: boolean } }) {
  useNav();
  useRealtimeRefresh(user.id);
  usePresence();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [sidebar, setSidebar] = useState(true);
  const [fullscreen, setFullscreen] = useState(info.fullscreen);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hsDialog, setHsDialog] = useState<null | "create" | "browse">(null);
  useEffect(() => {
    const create = () => setHsDialog("create");
    const browse = () => setHsDialog("browse");
    window.addEventListener("ch:hs-create-channel", create);
    window.addEventListener("ch:hs-browse", browse);
    return () => { window.removeEventListener("ch:hs-create-channel", create); window.removeEventListener("ch:hs-browse", browse); };
  }, []);
  const heySocial = useHeySocialAccess().data === true;

  useEffect(() => ch.app.setHeySocialAccess(heySocial), [heySocial]);
  useEffect(() => ch.window.onFullscreen(setFullscreen), []);
  useEffect(() => ch.app.onUpdateReady(setUpdateReady), []);
  useEffect(() => ch.app.onNavigate((path) => openPath(path)), []);
  // From a pop-out: "dm:<id>", "channel:<id>", "profile:<id>".
  useEffect(() => ch.app.onNavigateView((target) => {
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
      case "go:activity": return nav.section("activity");
      case "workspace:ch": return nav.workspace("ch");
      case "workspace:hs": return heySocial ? nav.workspace("hs") : undefined;
      case "quick-open": return setOverlay((open) => (open === "quick-open" ? null : "quick-open"));
      case "shortcuts": return setOverlay("shortcuts");
      case "settings": return ch.window.popout({ kind: "settings", id: "main" });
      case "toggle-sidebar": return setSidebar((open) => !open);
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
    <div className={`app ${sidebar ? "" : "no-sidebar"} ${fullscreen ? "fullscreen" : ""}`}>
      <TopBar preview={info.preview} updateReady={updateReady} />
      <Rail user={user} />
      <Sidebar user={user} />
      <Main user={user} />
      {overlay === "quick-open" ? <QuickSwitcher onClose={close} /> : null}
      {overlay === "shortcuts" ? <ShortcutsSheet onClose={close} /> : null}
      {overlay === "settings" ? <SettingsSheet user={user} version={info.version} onClose={close} /> : null}
      {overlay === "new-message" ? <NewMessage onClose={close} workspace={nav.get().ws === "hs" ? "heysocial" : "creatorhive"} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
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
    void ch.auth.session().then(({ user }) => setAuth(user ? { state: "signedIn", user } : { state: "signedOut" }));
    // Menu commands arrive before or after sign-in; route them through one place.
    const offCommand = ch.app.onCommand((id) => commands.run(id as Command));
    const offAuth = ch.auth.onChanged(() => {
      queryClient.clear();
      nav.reset();
      setAuth({ state: "signedOut" });
    });
    return () => {
      offCommand();
      offAuth();
    };
  }, []);

  if (auth.state === "loading") return <div className="signin" />;
  if (auth.state === "signedOut") return <SignIn onSignedIn={(user) => setAuth({ state: "signedIn", user })} />;
  return <Workspace key={auth.user.id} user={auth.user} info={info} />;
}
