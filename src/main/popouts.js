"use strict";

/*
  A DM, channel or thread in its own small window (⌘⇧O). Each pop-out loads
  the same interface with `#popout/<kind>/<id>` and shows only that
  conversation. Opening the same one again brings its window forward.
*/

const path = require("node:path");
const { BrowserWindow, shell } = require("electron");
const { RENDERER_URL } = require("./config");

const windows = new Map(); // "dm:<id>" -> BrowserWindow
const KINDS = new Set(["dm", "channel", "thread", "deal", "lesson", "settings"]);
const ID = /^[A-Za-z0-9:_-]{1,120}$/;

function open(target, chrome) {
  const kind = target?.kind;
  const id = target?.id;
  if (!KINDS.has(kind) || typeof id !== "string" || !ID.test(id)) return;
  const key = `${kind}:${id}`;
  const existing = windows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }

  const shape = kind === "settings" ? { width: 760, height: 720, minWidth: 640, minHeight: 520, resizable: true, maximizable: false, fullscreenable: false }
    : kind === "lesson" ? { width: 640, height: 380, minWidth: 320, minHeight: 200, alwaysOnTop: true }
    : kind === "deal" ? { width: 1000, height: 760, minWidth: 720, minHeight: 520 }
    : { width: 560, height: 680, minWidth: 380, minHeight: 420 };
  const win = new BrowserWindow({
    ...shape,
    title: typeof target.title === "string" ? target.title.slice(0, 120) : "CreatorHive",
    show: false,
    ...chrome(),
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  windows.set(key, win);
  win.on("closed", () => windows.delete(key));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (RENDERER_URL && url.startsWith(RENDERER_URL)) return;
    event.preventDefault();
  });

  const hash = `popout/${kind}/${encodeURIComponent(id)}`;
  if (RENDERER_URL) void win.loadURL(`${RENDERER_URL}#${hash}`);
  else void win.loadFile(path.join(__dirname, "..", "..", "renderer", "dist", "index.html"), { hash });
}

function broadcast(channel, payload) {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** Whether a focused pop-out shows this conversation or channel (so don't notify). */
function isFocusedOn(id) {
  for (const [key, win] of windows) {
    if (!win.isDestroyed() && win.isFocused() && key.endsWith(`:${id}`)) return true;
  }
  return false;
}

function closeAll() {
  for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
  windows.clear();
}

module.exports = { open, broadcast, isFocusedOn, closeAll };
