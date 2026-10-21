"use strict";

/*
  CreatorHive for Mac.

  The window is the live website, unchanged: everything shipped on the web
  shows up here without an app update. What the app adds is what a browser tab
  cannot do: notifications while the window is closed, the Dock badge, the menu
  bar icon, opening at login and updating itself.

  Notifications arrive on the member's own Ably channel (`user:<id>`), where the
  server publishes the same notification it sends to their phone. The listener
  lives here in the main process, not in the page, so it keeps working while the
  window is closed or the page is reloading.
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
  nativeImage,
  nativeTheme,
  powerMonitor,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const Ably = require("ably");

const HOME_URL = process.env.CREATORHIVE_URL || "https://community.creatorhiveacademy.com";
const ORIGIN = new URL(HOME_URL).origin;
const PARTITION = "persist:creatorhive";

/* Must match DESKTOP_NOTIFICATION_EVENT in the web app's lib/realtime/channels.ts. */
const DESKTOP_NOTIFICATION_EVENT = "notification:desktop";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const BADGE_POLL_FOCUSED_MS = 30 * 1000;
const BADGE_POLL_HIDDEN_MS = 5 * 60 * 1000;
const PAUSE_MS = 60 * 60 * 1000;

// For testing against a local copy of the site without touching the real app's data.
if (process.env.CREATORHIVE_USER_DATA) app.setPath("userData", process.env.CREATORHIVE_USER_DATA);
const debug = (...args) => {
  if (process.env.CREATORHIVE_DEBUG) console.log("[creatorhive]", ...args);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId("com.creatorhive.desktop");

/* ---------- Settings ---------- */

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const DEFAULT_SETTINGS = { notifications: true, pausedUntil: 0, bounds: null };
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

/* ---------- Window ---------- */

let mainWindow = null;
let tray = null;
let quitting = false;
let unread = 0;
let heySocialAccess = false;
let updateReady = null;

const appSession = () => session.fromPartition(PARTITION);

function isOwnUrl(url) {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

function openExternally(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL; nothing to open.
  }
}

function createWindow({ show }) {
  const bounds = settings.bounds ?? { width: 1280, height: 860 };
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    title: "CreatorHive",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#161514" : "#F7F6F4",
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  const contents = mainWindow.webContents;
  contents.setUserAgent(`${contents.getUserAgent()} CreatorHiveDesktop/${app.getVersion()}`);

  // Links to other sites open in the normal browser; our own stay here.
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url)) contents.loadURL(url);
    else openExternally(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isOwnUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });

  // Signing in or out shows up as a navigation; follow it with the listener.
  contents.on("did-navigate", () => void onPageChanged());
  contents.on("did-navigate-in-page", () => void onPageChanged());
  // The site keeps "(3) CreatorHive" in the title as DMs are read and arrive.
  contents.on("page-title-updated", () => refreshBadgeSoon());

  mainWindow.once("ready-to-show", () => {
    if (show) mainWindow.show();
  });
  mainWindow.on("focus", () => refreshBadgeSoon());

  // Closing hides: the app keeps running in the menu bar and keeps notifying.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  const rememberBounds = () => {
    if (!mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      settings.bounds = mainWindow.getBounds();
      saveSettings();
    }
  };
  mainWindow.on("resized", rememberBounds);
  mainWindow.on("moved", rememberBounds);

  void mainWindow.loadURL(HOME_URL);
}

function showWindow() {
  if (!mainWindow) createWindow({ show: true });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Open a site path such as `/messages?convo=…` in the window. */
function openPath(target) {
  showWindow();
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) return;
  void mainWindow.loadURL(`${ORIGIN}${target}`);
}

/* ---------- Permissions ---------- */

function configureSession() {
  const ses = appSession();
  // Voice memos and video need the microphone and camera; macOS still asks the
  // person the first time. Notifications are allowed so the site never shows
  // its "turn on notifications" banner: the app delivers them itself.
  const allowed = new Set([
    "media",
    "notifications",
    "clipboard-sanitized-write",
    "fullscreen",
    "pointerLock",
  ]);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed.has(permission) && isOwnUrl(details.requestingUrl ?? contents.getURL()));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => (
    allowed.has(permission) && requestingOrigin === ORIGIN
  ));
}

/* ---------- Notifications ---------- */

let realtime = null;
let realtimeUserId = null;
const shownByTag = new Map();

async function siteFetch(pathname) {
  return appSession().fetch(`${ORIGIN}${pathname}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
}

/** Signed out answers 401, or is sent to the sign-in page as HTML. */
function signedOut(response) {
  if (response.status === 401) return true;
  if (response.redirected && new URL(response.url).pathname.startsWith("/sign-in")) return true;
  return !(response.headers.get("content-type") ?? "").includes("application/json");
}

function stopRealtime() {
  if (!realtime) return;
  realtime.close();
  realtime = null;
  realtimeUserId = null;
}

function startRealtime() {
  if (realtime) return;
  const client = new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        const response = await siteFetch("/api/realtime/token");
        if (signedOut(response)) {
          // Signed out. Stop until the page shows a sign-in.
          callback("signed out", null);
          setImmediate(() => {
            if (realtime === client) stopRealtime();
            setUnread(0);
          });
          return;
        }
        const body = await response.json();
        if (!body?.ok) throw new Error(body?.error || `token ${response.status}`);
        callback(null, body.tokenRequest);
      } catch (error) {
        callback(String(error?.message ?? error), null);
      }
    },
  });
  realtime = client;

  client.connection.on("connected", () => {
    const userId = client.auth.clientId;
    if (!userId || userId === realtimeUserId) return;
    realtimeUserId = userId;
    debug("listening", userId);
    const channel = client.channels.get(`user:${userId}`);
    void channel.subscribe((message) => {
      debug("signal", message.name);
      if (message.name === DESKTOP_NOTIFICATION_EVENT) showNotification(message.data);
      // Every signal on this channel can move the unread count.
      refreshBadgeSoon();
    });
    void refreshBadge();
    void refreshHeySocialAccess();
  });
}

/** Already looking at the conversation this is about: say nothing, like the web. */
function isViewing(payload) {
  if (!mainWindow || !mainWindow.isVisible() || !mainWindow.isFocused()) return false;
  const data = payload?.data ?? {};
  const current = mainWindow.webContents.getURL();
  const id = data.conversationId ?? data.channelId;
  return typeof id === "string" && current.includes(id);
}

function showNotification(payload) {
  if (!payload || typeof payload.title !== "string") return;
  if (!settings.notifications || notificationsPaused() || isViewing(payload)) {
    debug("notification skipped", payload.title);
    return;
  }
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: payload.title,
    body: typeof payload.body === "string" ? payload.body : "",
  });
  notification.on("click", () => openPath(payload.url));
  notification.on("close", () => {
    if (payload.tag && shownByTag.get(payload.tag) === notification) shownByTag.delete(payload.tag);
  });
  // A tag replaces the earlier notification for the same thing, as on iPhone.
  if (payload.tag) {
    shownByTag.get(payload.tag)?.close();
    shownByTag.set(payload.tag, notification);
  }
  notification.show();
  debug("notification shown", payload.title);
}

/* ---------- Badge ---------- */

let badgeTimer = null;

function refreshBadgeSoon() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => void refreshBadge(), 750);
}

async function refreshBadge() {
  try {
    const response = await siteFetch("/api/notifications/badge");
    if (signedOut(response)) return setUnread(0);
    if (!response.ok) return;
    const body = await response.json();
    if (body?.ok && Number.isFinite(body.badge)) setUnread(body.badge);
  } catch {
    // Offline: keep the last count.
  }
}

function setUnread(count) {
  unread = Math.max(0, Math.floor(count));
  debug("badge", unread);
  app.setBadgeCount(unread);
  updateTray();
}

function scheduleBadgePoll() {
  const focused = mainWindow?.isVisible() && mainWindow.isFocused();
  setTimeout(() => {
    if (realtime) void refreshBadge();
    scheduleBadgePoll();
  }, focused ? BADGE_POLL_FOCUSED_MS : BADGE_POLL_HIDDEN_MS);
}

async function refreshHeySocialAccess() {
  try {
    const response = await siteFetch("/api/hey-social/access");
    heySocialAccess = response.ok;
  } catch {
    // Keep what we had.
  }
  updateTray();
}

async function onPageChanged() {
  const url = mainWindow?.webContents.getURL() ?? "";
  if (!isOwnUrl(url)) return;
  const { pathname } = new URL(url);
  if (pathname.startsWith("/sign-in")) {
    stopRealtime();
    setUnread(0);
    heySocialAccess = false;
    updateTray();
    return;
  }
  startRealtime();
  refreshBadgeSoon();
}

/* ---------- Menu bar icon ---------- */

function trayImage() {
  const name = unread > 0 ? "trayUnreadTemplate.png" : "trayTemplate.png";
  const image = nativeImage.createFromPath(path.join(__dirname, "..", "assets", name));
  image.setTemplateImage(true);
  return image;
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayImage());
  tray.setToolTip(unread > 0 ? `CreatorHive — ${unread} unread` : "CreatorHive");

  const loginItem = app.getLoginItemSettings();
  const paused = notificationsPaused();
  const template = [
    { label: "Open CreatorHive", accelerator: "CommandOrControl+O", click: showWindow },
    {
      label: unread > 0 ? `Unread: ${unread}` : "No unread messages",
      enabled: unread > 0,
      click: () => openPath("/messages"),
    },
    { type: "separator" },
    { label: "CreatorHive community", click: () => openPath("/") },
    ...(heySocialAccess ? [{ label: "Hey Social Inc.", click: () => openPath("/hey-social") }] : []),
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
    { label: "Quit CreatorHive", accelerator: "CommandOrControl+Q", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(trayImage());
  updateTray();
}

/* ---------- App menu ---------- */

function createAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { label: "Check for Updates…", click: () => void checkForUpdates(true) },
        { type: "separator" },
        { label: "Settings…", accelerator: "CommandOrControl+,", click: () => openPath("/settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
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
        { label: "Back", accelerator: "CommandOrControl+[", click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: "Forward", accelerator: "CommandOrControl+]", click: () => mainWindow?.webContents.navigationHistory.goForward() },
        { type: "separator" },
        { label: "Home", accelerator: "CommandOrControl+1", click: () => openPath("/") },
        { label: "DMs", accelerator: "CommandOrControl+2", click: () => openPath("/messages") },
        { label: "Hub", accelerator: "CommandOrControl+3", click: () => openPath("/hub") },
        { label: "Channels", accelerator: "CommandOrControl+4", click: () => openPath("/channels") },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "CreatorHive Support", click: () => openPath("/support") }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Updates ---------- */

function configureUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = info.version;
    updateTray();
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
        ? `CreatorHive ${result.updateInfo.version} is downloading. You'll be asked to restart when it's ready.`
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

/* ---------- Lifecycle ---------- */

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
  stopRealtime();
});
// Closing the window never quits; only Quit does.
app.on("window-all-closed", () => {});

app.whenReady().then(() => {
  loadSettings();
  configureSession();
  createAppMenu();
  createTray();

  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  createWindow({ show: !openedAtLogin });
  startRealtime();
  scheduleBadgePoll();
  configureUpdates();

  // After sleep the socket is stale; reconnect and correct the count.
  powerMonitor.on("resume", () => {
    realtime?.connection.connect();
    refreshBadgeSoon();
  });
});
