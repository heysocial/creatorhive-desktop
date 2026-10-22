"use strict";

/*
  CreatorHive for Mac, 2.0.

  The window is the app's own interface (renderer/), not the website. It talks
  to the CreatorHive server only through this process (site.js), which holds
  the session cookies, and hears live updates from the Ably connection here
  (realtime.js), which keeps running while the window is closed. This process
  also owns everything macOS gives an app: menus, notifications, the Dock
  badge, the menu bar icon, opening at login and updating itself.
*/

const path = require("node:path");
const fs = require("node:fs");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  dialog,
  session,
  desktopCapturer,
  globalShortcut,
  ShareMenu,
  clipboard,
  systemPreferences,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { ORIGIN, IS_PREVIEW, RENDERER_URL, debug } = require("./config");
const site = require("./site");
const google = require("./google");
const realtime = require("./realtime");
const media = require("./media");
const popouts = require("./popouts");
const files = require("./files");

/* Must match DESKTOP_NOTIFICATION_EVENT in the web app's lib/realtime/channels.ts. */
const DESKTOP_NOTIFICATION_EVENT = "notification:desktop";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const BADGE_POLL_FOCUSED_MS = 30 * 1000;
const BADGE_POLL_HIDDEN_MS = 5 * 60 * 1000;
const PAUSE_MS = 60 * 60 * 1000;
const IS_MAC = process.platform === "darwin";

// For testing against a local copy of the site without touching the real app's data.
if (process.env.CREATORHIVE_USER_DATA) app.setPath("userData", process.env.CREATORHIVE_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

media.registerScheme();

app.setAppUserModelId(IS_PREVIEW ? "com.creatorhive.desktop.preview" : "com.creatorhive.desktop");

/* ---------- Settings ---------- */

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const DEFAULT_SETTINGS = {
  notifications: !IS_PREVIEW, pausedUntil: 0, bounds: null,
  sound: "honey", badge: "mentions", keepRunning: true, theme: "system", zoom: 1, touchId: false,
};

/* Touch ID: when it's on, the window stays locked after launch, sleep or the Mac locking, until you unlock. */
let locked = false;
const touchIdAvailable = () => process.platform === "darwin" && systemPreferences.canPromptTouchID();
function lockIfNeeded() {
  if (!settings.touchId || !touchIdAvailable() || locked) return;
  locked = true;
  broadcast("app:locked", true);
}
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("[settings] save failed", error);
  }
}

const notificationsPaused = () => Date.now() < settings.pausedUntil;

/* Theme and text size apply to every window at once. */
function applyLook() {
  nativeTheme.themeSource = ["light", "dark"].includes(settings.theme) ? settings.theme : "system";
  const zoom = Math.min(1.4, Math.max(0.8, Number(settings.zoom) || 1));
  for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomFactor(zoom);
}

/** What the Settings window shows and changes. */
function publicSettings() {
  return {
    notifications: settings.notifications,
    pausedUntil: settings.pausedUntil,
    sound: settings.sound,
    badge: settings.badge,
    keepRunning: settings.keepRunning,
    theme: settings.theme,
    zoom: settings.zoom,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    touchId: settings.touchId,
    touchIdAvailable: touchIdAvailable(),
  };
}

function changeSettings(patch = {}) {
  if (typeof patch.notifications === "boolean") settings.notifications = patch.notifications;
  if (Number.isFinite(patch.pausedUntil)) settings.pausedUntil = patch.pausedUntil;
  if (["honey", "system", "none"].includes(patch.sound)) settings.sound = patch.sound;
  if (["mentions", "off"].includes(patch.badge)) settings.badge = patch.badge;
  if (typeof patch.keepRunning === "boolean") settings.keepRunning = patch.keepRunning;
  if (["system", "light", "dark"].includes(patch.theme)) settings.theme = patch.theme;
  if (Number.isFinite(patch.zoom)) settings.zoom = patch.zoom;
  if (typeof patch.openAtLogin === "boolean") app.setLoginItemSettings({ openAtLogin: patch.openAtLogin });
  if (typeof patch.touchId === "boolean") settings.touchId = patch.touchId && touchIdAvailable();
  saveSettings();
  applyLook();
  setUnread(unread);
  updateTray();
  return publicSettings();
}

/* ---------- Window ---------- */

let mainWindow = null;
let tray = null;
let quitting = false;
let unread = 0;
let signedIn = false;
let heySocialAccess = false;
let updateReady = null;
let viewing = null; // the conversation or channel id the person has open

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** To the main window and every pop-out (live updates, sign-out). */
function broadcast(channel, payload) {
  send(channel, payload);
  popouts.broadcast(channel, payload);
}

function openExternally(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL; nothing to open.
  }
}

function windowChrome() {
  if (IS_MAC) {
    // No title bar: the window buttons sit in our own top bar, and the rail and
    // sidebar show the desktop through macOS's sidebar material.
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 17 },
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
      backgroundColor: "#00000000",
    };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#F3F1ED" : "#1F1E1C", height: 46 },
    backgroundMaterial: "mica",
    backgroundColor: "#00000000",
  };
}

function createWindow({ show }) {
  const bounds = settings.bounds ?? { width: 1320, height: 880 };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 620,
    title: IS_PREVIEW ? "CreatorHive Preview" : "CreatorHive",
    show: false,
    ...windowChrome(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  const contents = mainWindow.webContents;
  // The interface is a single page; anything that tries to leave it opens in the browser.
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (RENDERER_URL && url.startsWith(RENDERER_URL)) return;
    event.preventDefault();
    openExternally(url);
  });

  mainWindow.on("enter-full-screen", () => send("window:fullscreen", true));
  mainWindow.on("leave-full-screen", () => send("window:fullscreen", false));
  mainWindow.on("focus", () => {
    send("window:focus", true);
    refreshBadgeSoon();
  });
  mainWindow.on("blur", () => send("window:focus", false));
  mainWindow.once("ready-to-show", () => {
    if (show) mainWindow.show();
  });

  // Closing hides: the app keeps running in the menu bar and keeps notifying.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    if (!settings.keepRunning) {
      quitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    if (mainWindow.isFullScreen()) {
      mainWindow.once("leave-full-screen", () => mainWindow.hide());
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.hide();
    }
  });
  const rememberBounds = () => {
    if (!mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      settings.bounds = mainWindow.getBounds();
      saveSettings();
    }
  };
  mainWindow.on("resized", rememberBounds);
  mainWindow.on("moved", rememberBounds);

  contents.on("did-finish-load", applyLook);
  if (RENDERER_URL) void mainWindow.loadURL(RENDERER_URL);
  else void mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "dist", "index.html"));
}

function showWindow() {
  if (!mainWindow) createWindow({ show: true });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Open a website path (from a notification or the menu bar) in the app. */
function openPath(target) {
  showWindow();
  if (typeof target === "string" && target.startsWith("/") && !target.startsWith("//")) send("navigate", target);
}

function command(id) {
  if (id === "settings") return void popouts.open({ kind: "settings", id: "main" }, windowChrome);
  showWindow();
  send("command", id);
}

/* ---------- Sign-in state ---------- */

function setSignedIn(next) {
  if (signedIn === next) return;
  signedIn = next;
  if (next) {
    realtime.start();
    refreshBadgeSoon();
  } else {
    realtime.stop();
    setUnread(0);
    heySocialAccess = false;
    viewing = null;
    popouts.closeAll();
    send("auth:changed", null);
  }
  createAppMenu();
  updateTray();
}

/* ---------- IPC: what the interface may ask for ---------- */

function configureIpc() {
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    preview: IS_PREVIEW,
    platform: process.platform,
    origin: ORIGIN,
    fullscreen: mainWindow?.isFullScreen() ?? false,
  }));

  ipcMain.handle("auth:session", async () => {
    const user = await site.getSession();
    if (user === undefined) return { user: null, offline: true };
    setSignedIn(Boolean(user));
    return { user };
  });
  ipcMain.handle("auth:signIn", async (_event, { email, password } = {}) => {
    const result = await site.signIn(email, password);
    if (result.ok) setSignedIn(true);
    return result;
  });
  ipcMain.handle("auth:googleAvailable", () => google.googleAvailable());
  ipcMain.handle("auth:google", async () => {
    // Back to the app the moment the browser returns, before the exchange finishes.
    const result = await google.signInWithGoogle({ onReturn: showWindow });
    if (result.ok) setSignedIn(true);
    return result;
  });
  ipcMain.on("auth:googleCancel", () => google.cancelGoogle());
  ipcMain.handle("auth:signOut", async () => {
    await site.signOut();
    setSignedIn(false);
    return { ok: true };
  });

  ipcMain.handle("api:request", async (_event, request) => {
    const result = await site.apiRequest(request);
    if (result.signedOut) setSignedIn(false);
    return result;
  });

  ipcMain.on("realtime:watch", (_event, name) => realtime.watch(name));
  ipcMain.on("realtime:unwatch", (_event, name) => realtime.unwatch(name));

  ipcMain.on("app:viewing", (event, id) => {
    // Pop-outs report what they show themselves; only the main window sets this.
    if (mainWindow && event.sender !== mainWindow.webContents) return;
    viewing = typeof id === "string" && id ? id : null;
  });
  ipcMain.on("window:popout", (_event, target) => popouts.open(target, windowChrome));
  ipcMain.handle("settings:get", () => publicSettings());
  ipcMain.handle("settings:set", (_event, patch) => changeSettings(patch));
  ipcMain.on("app:checkUpdates", () => void checkForUpdates(true));
  ipcMain.handle("api:stream", (event, request) => site.apiStream(request, (line) => {
    if (!event.sender.isDestroyed()) event.sender.send("api:stream:line", { id: request?.id, line });
  }));
  ipcMain.handle("files:uploadForm", (_event, request) => site.uploadForm(request));
  ipcMain.on("app:openMain", (_event, target) => {
    showWindow();
    if (typeof target === "string") send("navigate:view", target);
  });
  files.configure(ipcMain);
  ipcMain.handle("app:isLocked", () => locked);
  // A picture on the clipboard (a screenshot, an image copied from Preview or a browser), as PNG bytes.
  ipcMain.handle("clipboard:image", () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image.toPNG();
  });
  ipcMain.handle("app:unlock", async () => {
    if (!locked) return true;
    try {
      await systemPreferences.promptTouchID("unlock CreatorHive");
      locked = false;
      broadcast("app:locked", false);
      return true;
    } catch {
      return false;
    }
  });
  // The Mac's Share menu (Messages, Mail, AirDrop, Notes…) for a link.
  ipcMain.on("app:share", (event, { url, text } = {}) => {
    if (typeof url !== "string" || !/^https:\/\//.test(url)) return;
    const menu = new ShareMenu({ urls: [url], texts: typeof text === "string" && text ? [text] : undefined });
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
  });
  ipcMain.on("app:relay", (_event, message) => {
    if (message && typeof message.topic === "string") broadcast("app:relay", message);
  });
  // ⇧⌘Space mutes the huddle from any app, only while you're in one.
  popouts.onWindowsChanged(() => {
    const accelerator = "Shift+CommandOrControl+Space";
    if (popouts.inHuddle() && !globalShortcut.isRegistered(accelerator)) {
      globalShortcut.register(accelerator, () => broadcast("app:relay", { topic: "huddle", action: "toggle-mic" }));
    } else if (!popouts.inHuddle() && globalShortcut.isRegistered(accelerator)) {
      globalShortcut.unregister(accelerator);
    }
  });
  ipcMain.on("app:heySocialAccess", (_event, value) => {
    heySocialAccess = Boolean(value);
    createAppMenu();
    updateTray();
  });
  ipcMain.on("app:openExternal", (_event, url) => openExternally(url));
  ipcMain.on("app:openSite", (_event, target) => {
    if (typeof target === "string" && target.startsWith("/") && !target.startsWith("//")) openExternally(`${ORIGIN}${target}`);
  });
  ipcMain.on("badge:refresh", () => refreshBadgeSoon());

  /*
    A native context menu. The interface describes the items; the chosen id
    comes back (or null when dismissed).
  */
  ipcMain.handle("menu:popup", (event, items) => new Promise((resolve) => {
    let chosen = null;
    const build = (list) => (Array.isArray(list) ? list : []).slice(0, 40).map((item) => {
      if (item?.type === "separator") return { type: "separator" };
      return {
        label: String(item?.label ?? ""),
        enabled: item?.enabled !== false,
        accelerator: typeof item?.accelerator === "string" ? item.accelerator : undefined,
        registerAccelerator: false,
        type: item?.checked === undefined ? "normal" : "checkbox",
        checked: Boolean(item?.checked),
        submenu: item?.submenu ? build(item.submenu) : undefined,
        click: () => { chosen = String(item?.id ?? ""); },
      };
    });
    const menu = Menu.buildFromTemplate(build(items));
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
      callback: () => resolve(chosen),
    });
  }));
}

/* ---------- Notifications ---------- */

const shownByTag = new Map();

/** Already looking at the conversation this is about: say nothing, like the web. */
function isViewing(payload) {
  const data = payload?.data ?? {};
  const about = data.conversationId ?? data.channelId;
  if (about && popouts.isFocusedOn(about)) return true;
  if (!mainWindow || !mainWindow.isVisible() || !mainWindow.isFocused() || !viewing) return false;
  return viewing === about;
}

function showNotification(payload) {
  if (!payload || typeof payload.title !== "string") return;
  if (!settings.notifications || notificationsPaused() || isViewing(payload)) {
    debug("notification skipped", payload.title);
    return;
  }
  if (!Notification.isSupported()) return;

  // A DM (or a mention in a channel) can be answered from the banner, as in Messages.
  const data = payload.data ?? {};
  const replyTarget = typeof data.conversationId === "string" ? { kind: "dms", id: data.conversationId }
    : typeof data.channelId === "string" && /mention|thread|reply/.test(String(data.type ?? "")) ? { kind: "channels", id: data.channelId, parent: data.parentMessageId ?? data.threadId ?? null }
    : null;
  const notification = new Notification({
    title: payload.title,
    body: typeof payload.body === "string" ? payload.body : "",
    hasReply: Boolean(replyTarget),
    replyPlaceholder: "Reply…",
    silent: settings.sound === "none",
    // The honey chime is macOS's Glass until the app ships its own sound.
    sound: settings.sound === "honey" ? "Glass" : undefined,
  });
  notification.on("click", () => openPath(payload.url));
  notification.on("reply", (_event, reply) => {
    if (!replyTarget || typeof reply !== "string" || !reply.trim()) return;
    void site.apiRequest({
      method: "POST",
      path: `/api/${replyTarget.kind}/${replyTarget.id}/messages`,
      body: { body: reply, clientMutationId: require("node:crypto").randomUUID(), ...(replyTarget.parent ? { parentMessageId: replyTarget.parent } : {}) },
    }).then((result) => {
      if (!result.ok) new Notification({ title: "Your reply wasn't sent", body: "Open CreatorHive to try again." }).show();
      else void site.apiRequest({ method: "POST", path: "/api/messages/read", body: replyTarget.kind === "dms" ? { conversationId: replyTarget.id } : { channelId: replyTarget.id } }).then(refreshBadgeSoon);
    });
  });
  notification.on("close", () => {
    if (payload.tag && shownByTag.get(payload.tag) === notification) shownByTag.delete(payload.tag);
  });
  // A tag replaces the earlier notification for the same thing, as on iPhone.
  if (payload.tag) {
    shownByTag.get(payload.tag)?.close();
    shownByTag.set(payload.tag, notification);
  }
  notification.show();
}

function configureRealtime() {
  realtime.on("message", (message) => {
    if (message.channel.startsWith("user:")) {
      if (message.name === DESKTOP_NOTIFICATION_EVENT) showNotification(message.data);
      // Every signal on this channel can move the unread count.
      refreshBadgeSoon();
    }
    broadcast("realtime:message", message);
  });
  realtime.on("state", (state) => broadcast("realtime:state", state));
  realtime.on("connected", () => void refreshBadge());
  realtime.on("signedOut", () => setSignedIn(false));
}

/* ---------- Badge ---------- */

let badgeTimer = null;

function refreshBadgeSoon() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => void refreshBadge(), 750);
}

async function refreshBadge() {
  if (!signedIn) return;
  const result = await site.apiRequest({ path: "/api/notifications/badge" });
  if (result.signedOut) return setSignedIn(false);
  if (result.ok && Number.isFinite(result.data?.badge)) setUnread(result.data.badge);
}

function setUnread(count) {
  unread = Math.max(0, Math.floor(count));
  app.setBadgeCount(settings.badge === "off" ? 0 : unread);
  updateTray();
}

function scheduleBadgePoll() {
  const focused = mainWindow?.isVisible() && mainWindow.isFocused();
  setTimeout(() => {
    void refreshBadge();
    scheduleBadgePoll();
  }, focused ? BADGE_POLL_FOCUSED_MS : BADGE_POLL_HIDDEN_MS);
}

/* ---------- Menu bar icon ---------- */

function trayImage() {
  const name = unread > 0 ? "trayUnreadTemplate.png" : "trayTemplate.png";
  const image = nativeImage.createFromPath(path.join(__dirname, "..", "..", "assets", name));
  image.setTemplateImage(true);
  return image;
}

function updateTray() {
  if (!tray) return;
  const appName = IS_PREVIEW ? "CreatorHive Preview" : "CreatorHive";
  tray.setImage(trayImage());
  tray.setToolTip(unread > 0 ? `${appName} — ${unread} unread` : appName);

  const loginItem = app.getLoginItemSettings();
  const paused = notificationsPaused();
  const template = [
    { label: `Open ${appName}`, click: showWindow },
    {
      label: unread > 0 ? `Unread: ${unread}` : "No unread messages",
      enabled: unread > 0 && signedIn,
      click: () => command("go:dms"),
    },
    { type: "separator" },
    { label: "New message", enabled: signedIn, click: () => command("new-message") },
    { label: "CreatorHive community", enabled: signedIn, click: () => command("workspace:ch") },
    ...(heySocialAccess ? [{ label: "Hey Social Inc.", click: () => command("workspace:hs") }] : []),
    { type: "separator" },
    {
      label: "Open at login",
      type: "checkbox",
      checked: loginItem.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        updateTray();
      },
    },
    {
      label: "Show notifications",
      type: "checkbox",
      checked: settings.notifications,
      click: (item) => {
        settings.notifications = item.checked;
        saveSettings();
        updateTray();
      },
    },
    {
      label: paused ? "Resume notifications" : "Pause notifications for 1 hour",
      enabled: settings.notifications,
      click: () => {
        settings.pausedUntil = paused ? 0 : Date.now() + PAUSE_MS;
        saveSettings();
        updateTray();
        if (!paused) setTimeout(updateTray, PAUSE_MS + 1000);
      },
    },
    { type: "separator" },
    updateReady
      ? { label: `Restart to update to ${updateReady}`, click: installUpdate }
      : { label: "Check for updates…", sublabel: `Version ${app.getVersion()}`, click: () => void checkForUpdates(true) },
    { label: `Quit ${appName}`, accelerator: "CommandOrControl+Q", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(trayImage());
  updateTray();
}

/* ---------- App menu ---------- */

function createAppMenu() {
  const go = (label, accelerator, id, enabled = signedIn) => ({ label, accelerator, enabled, click: () => command(id) });
  const template = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => void checkForUpdates(true) },
        { type: "separator" },
        { label: "Settings…", accelerator: "CommandOrControl+,", enabled: signedIn, click: () => command("settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: "Sign Out", enabled: signedIn, click: () => command("sign-out") },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [
        go("New Message", "CommandOrControl+N", "new-message"),
        go("New Post", "Shift+CommandOrControl+N", "new-post"),
        { type: "separator" },
        go("Open in New Window", "Shift+CommandOrControl+O", "popout"),
        { type: "separator" },
        go("New Deal", "Alt+CommandOrControl+N", "new-deal"),
        go("Export Deals…", "Shift+CommandOrControl+E", "export"),
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        go("Toggle Sidebar", "Control+Command+S", "toggle-sidebar"),
        { type: "separator" },
        ...(app.isPackaged ? [] : [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }]),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        go("Back", "CommandOrControl+[", "back"),
        go("Forward", "CommandOrControl+]", "forward"),
        { type: "separator" },
        go("Search…", "CommandOrControl+K", "quick-open"),
        { type: "separator" },
        go("Home", "CommandOrControl+1", "go:home"),
        go("DMs", "CommandOrControl+2", "go:dms"),
        go("Hub", "CommandOrControl+3", "go:hub"),
        go("Learn", "CommandOrControl+4", "go:learn"),
        go("Activity", "CommandOrControl+5", "go:activity"),
        { type: "separator" },
        go("CreatorHive", "Control+CommandOrControl+1", "workspace:ch"),
        go("Hey Social Inc.", "Control+CommandOrControl+2", "workspace:hs", signedIn && heySocialAccess),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        go("Keyboard Shortcuts", "CommandOrControl+/", "shortcuts", true),
        { label: "CreatorHive Support", click: () => openExternally(`${ORIGIN}/support`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Updates ---------- */

function configureUpdates() {
  if (!app.isPackaged) return;
  // The preview follows its own prerelease channel; the real app never sees it.
  if (IS_PREVIEW) {
    autoUpdater.allowPrerelease = true;
    autoUpdater.channel = "preview";
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    debug("update downloaded", info.version);
    updateReady = info.version;
    updateTray();
    send("update:ready", info.version);
  });
  autoUpdater.on("error", (error) => console.error("[update]", error?.message ?? error));
  setTimeout(() => void checkForUpdates(false), 30 * 1000);
  setInterval(() => void checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

async function checkForUpdates(fromMenu) {
  if (!app.isPackaged) {
    if (fromMenu) void dialog.showMessageBox({ message: "Updates are only checked in the installed app." });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!fromMenu) return;
    const available = result?.isUpdateAvailable;
    void dialog.showMessageBox({
      message: available
        ? `${app.name} ${result.updateInfo.version} is downloading. You'll be asked to restart when it's ready.`
        : `You're on the latest version (${app.getVersion()}).`,
    });
  } catch (error) {
    if (fromMenu) {
      void dialog.showMessageBox({
        type: "warning",
        message: "Couldn't check for updates.",
        detail: "Check your internet connection and try again.",
      });
    }
    console.error("[update] check failed", error?.message ?? error);
  }
}

function installUpdate() {
  quitting = true;
  autoUpdater.quitAndInstall();
}
ipcMain.on("update:install", installUpdate);

/* ---------- Lifecycle ---------- */

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
  realtime.stop();
});
// Closing the window never quits; only Quit does.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  loadSettings();
  applyLook();
  media.handle();
  // Huddle screen sharing: the Mac's own picker where it has one, else the main screen.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
      callback({ video: sources.find((s) => s.id.startsWith("screen:")) ?? sources[0], audio: "loopback" });
    }).catch(() => callback({}));
  }, { useSystemPicker: true });
  // YouTube refuses to play embeds without a Referer; the lesson player sends the site's.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: `${ORIGIN}/` } });
  });
  site.configureUserAgent();
  configureIpc();
  configureRealtime();
  createAppMenu();
  createTray();

  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  createWindow({ show: !openedAtLogin });
  // Signed in from before (or from 1.x)? Start listening even with the window hidden.
  const user = await site.getSession();
  if (user) setSignedIn(true);
  scheduleBadgePoll();
  configureUpdates();

  lockIfNeeded();
  powerMonitor.on("lock-screen", lockIfNeeded);
  powerMonitor.on("suspend", lockIfNeeded);
  // After sleep the socket is stale; reconnect and correct the count.
  powerMonitor.on("resume", () => {
    realtime.reconnect();
    refreshBadgeSoon();
  });
});
