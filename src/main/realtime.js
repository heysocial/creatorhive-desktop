"use strict";

/*
  One Ably connection for the whole app, in the main process, so it keeps
  running while the window is closed. The member's own channel (`user:<id>`)
  is always on: it carries notifications and the "something changed" signals
  the website listens to. The interface can watch more channels (a DM, a
  channel it has open) and gets their messages forwarded over IPC.
*/

const Ably = require("ably");
const { siteFetch, signedOut } = require("./site");
const { debug } = require("./config");

let client = null;
let userId = null;
const watched = new Map(); // channel name -> number of watchers
const listeners = { message: () => {}, signedOut: () => {}, connected: () => {}, state: () => {} };

function on(event, fn) {
  listeners[event] = fn;
}

function forward(channelName, message) {
  listeners.message({ channel: channelName, name: message.name, data: message.data ?? null });
}

function subscribe(name) {
  if (!client) return;
  void client.channels.get(name).subscribe((message) => forward(name, message)).catch((error) => {
    debug("subscribe failed", name, error?.message);
  });
}

function start() {
  if (client) return;
  const next = new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        const response = await siteFetch("/api/realtime/token");
        if (signedOut(response)) {
          callback("signed out", null);
          setImmediate(() => {
            if (client === next) stop();
            listeners.signedOut();
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
  client = next;

  next.connection.on((change) => listeners.state(change.current));
  next.connection.on("connected", () => {
    const id = next.auth.clientId;
    if (!id || id === userId) return;
    userId = id;
    debug("listening", id);
    subscribe(`user:${id}`);
    for (const name of watched.keys()) subscribe(name);
    listeners.connected(id);
  });
}

function stop() {
  if (!client) return;
  client.close();
  client = null;
  userId = null;
}

function reconnect() {
  client?.connection.connect();
}

function watch(name) {
  if (typeof name !== "string" || !name || name.startsWith("user:")) return;
  const count = watched.get(name) ?? 0;
  watched.set(name, count + 1);
  if (count === 0 && userId) subscribe(name);
}

function unwatch(name) {
  const count = watched.get(name);
  if (!count) return;
  if (count > 1) return void watched.set(name, count - 1);
  watched.delete(name);
  client?.channels.get(name).unsubscribe();
  void client?.channels.get(name).detach().catch(() => {});
}

module.exports = { start, stop, reconnect, watch, unwatch, on, currentUserId: () => userId };
