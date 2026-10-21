"use strict";

/*
  Electron has no browser push service, so the site's push sign-up fails here
  and it would show "Notifications can't reach this browser". Hiding the Push
  API before the site's scripts run makes the site treat this as a browser
  without push and stay quiet. The app delivers notifications itself.
*/
const { contextBridge } = require("electron");

contextBridge.executeInMainWorld({
  func: () => {
    delete window.PushManager;
  },
});
