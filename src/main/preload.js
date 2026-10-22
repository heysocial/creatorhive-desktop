"use strict";

/*
  The bridge between the interface and the main process: `window.ch`. This is
  everything the interface can do outside its own page. Network calls, cookies,
  notifications and native menus all live in the main process.
*/

const { contextBridge, ipcRenderer } = require("electron");

function listen(channel) {
  return (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld("ch", {
  info: () => ipcRenderer.invoke("app:info"),
  auth: {
    session: () => ipcRenderer.invoke("auth:session"),
    signIn: (email, password) => ipcRenderer.invoke("auth:signIn", { email, password }),
    googleAvailable: () => ipcRenderer.invoke("auth:googleAvailable"),
    google: () => ipcRenderer.invoke("auth:google"),
    cancelGoogle: () => ipcRenderer.send("auth:googleCancel"),
    signOut: () => ipcRenderer.invoke("auth:signOut"),
    onChanged: listen("auth:changed"),
  },
  api: (request) => ipcRenderer.invoke("api:request", request),
  apiStream: (request, onLine) => {
    const id = `${Date.now()}-${Math.random()}`;
    const handler = (_event, payload) => { if (payload?.id === id) onLine(payload.line); };
    ipcRenderer.on("api:stream:line", handler);
    return ipcRenderer.invoke("api:stream", { ...request, id }).finally(() => ipcRenderer.removeListener("api:stream:line", handler));
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },
  realtime: {
    watch: (name) => ipcRenderer.send("realtime:watch", name),
    unwatch: (name) => ipcRenderer.send("realtime:unwatch", name),
    onMessage: listen("realtime:message"),
    onState: listen("realtime:state"),
  },
  menu: {
    popup: (items) => ipcRenderer.invoke("menu:popup", items),
  },
  app: {
    setViewing: (id) => ipcRenderer.send("app:viewing", id ?? null),
    setHeySocialAccess: (value) => ipcRenderer.send("app:heySocialAccess", Boolean(value)),
    openExternal: (url) => ipcRenderer.send("app:openExternal", url),
    openSite: (path) => ipcRenderer.send("app:openSite", path),
    refreshBadge: () => ipcRenderer.send("badge:refresh"),
    installUpdate: () => ipcRenderer.send("update:install"),
    checkUpdates: () => ipcRenderer.send("app:checkUpdates"),
    onCommand: listen("command"),
    onNavigate: listen("navigate"),
    onUpdateReady: listen("update:ready"),
    /** From a pop-out: show something in the main window ("dm:<id>", "channel:<id>"). */
    openMain: (target) => ipcRenderer.send("app:openMain", target),
    relay: (message) => ipcRenderer.send("app:relay", message),
    share: (url, text) => ipcRenderer.send("app:share", { url, text }),
    isLocked: () => ipcRenderer.invoke("app:isLocked"),
    unlock: () => ipcRenderer.invoke("app:unlock"),
    onLocked: listen("app:locked"),
    onRelay: listen("app:relay"),
    onNavigateView: listen("navigate:view"),
  },
  files: {
    upload: (request) => ipcRenderer.invoke("files:upload", request),
    quickLook: (url, name) => ipcRenderer.invoke("files:quickLook", { url, name }),
    save: (url, name) => ipcRenderer.invoke("files:save", { url, name }),
    addToCalendar: (ics, name) => ipcRenderer.invoke("files:addToCalendar", { ics, name }),
    uploadForm: (request) => ipcRenderer.invoke("files:uploadForm", request),
    clipboardImage: () => ipcRenderer.invoke("clipboard:image"),
    putVideo: (url, type, bytes) => ipcRenderer.invoke("files:putVideo", { url, type, bytes }),
  },
  window: {
    popout: (target) => ipcRenderer.send("window:popout", target),
    onFullscreen: listen("window:fullscreen"),
    onFocus: listen("window:focus"),
  },
});
