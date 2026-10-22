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
    signOut: () => ipcRenderer.invoke("auth:signOut"),
    onChanged: listen("auth:changed"),
  },
  api: (request) => ipcRenderer.invoke("api:request", request),
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
    onCommand: listen("command"),
    onNavigate: listen("navigate"),
    onUpdateReady: listen("update:ready"),
  },
  window: {
    onFullscreen: listen("window:fullscreen"),
    onFocus: listen("window:focus"),
  },
});
