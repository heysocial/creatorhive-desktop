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

type Auth = { state: "loading" } | { state: "signedOut" } | { state: "signedIn"; user: SessionUser };
type Overlay = null | "quick-open" | "shortcuts" | "settings";

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
  useRealtimeRefresh();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [sidebar, setSidebar] = useState(true);
  const [fullscreen, setFullscreen] = useState(info.fullscreen);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const heySocial = useHeySocialAccess().data === true;

  useEffect(() => ch.app.setHeySocialAccess(heySocial), [heySocial]);
  useEffect(() => ch.window.onFullscreen(setFullscreen), []);
  useEffect(() => ch.app.onUpdateReady(setUpdateReady), []);
  useEffect(() => ch.app.onNavigate((path) => openPath(path)), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  // Nothing in the app shows a conversation's messages yet, so no notification is ever "already seen".
  useEffect(() => ch.app.setViewing(null), []);

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
      case "settings": return setOverlay("settings");
      case "toggle-sidebar": return setSidebar((open) => !open);
      case "new-message":
        nav.section("dms");
        return setToast("Writing a new message comes in Phase 2. Pick a conversation, or open it on the website.");
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
      <Main />
      {overlay === "quick-open" ? <QuickSwitcher onClose={close} /> : null}
      {overlay === "shortcuts" ? <ShortcutsSheet onClose={close} /> : null}
      {overlay === "settings" ? <SettingsSheet user={user} version={info.version} onClose={close} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
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
