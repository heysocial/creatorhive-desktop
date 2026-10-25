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
const handlers = new Map(); // channel name -> its forwarding listener, so a retry never adds a second one
/*
  A token can only hear the channels listed when it was issued: a DM started,
  or a channel joined, after that needs a fresh token (the token route lists
  everything the member can read at that moment). `asked` remembers the
  channels a fresh token was already fetched for, so one the server won't
  grant is not asked for again and again.
*/
let granted = null; // channel names the current token may subscribe to
const asked = new Set();
const retried = new Set(); // channels refused on attach and tried once more with a fresh token
let authorizing = null;
const CAPABILITY_REFUSED = 40160;
const listeners = { message: () => {}, signedOut: () => {}, connected: () => {}, state: () => {} };

function on(event, fn) {
  listeners[event] = fn;
}

function forward(channelName, message) {
  listeners.message({ channel: channelName, name: message.name, data: message.data ?? null });
}

/** One token refresh for everything that asks at once. */
function reauthorize() {
  if (!client) return Promise.resolve();
  authorizing ??= client.auth.authorize().then(() => {
    // A channel refused by the last token and granted by this one gets another go.
    for (const name of watched.keys()) {
      if (granted?.has(name) && client?.channels.get(name).state === "failed") setImmediate(() => subscribe(name));
    }
  }, (error) => debug("authorize failed", error?.message)).finally(() => {
    authorizing = null;
  });
  return authorizing;
}

/** Make sure the token can hear these channels; fetches a fresh one, once, for any it doesn't list yet. */
function ensure(names) {
  if (!client || !granted || !Array.isArray(names)) return Promise.resolve();
  const missing = names.filter((name) => typeof name === "string" && name && !granted.has(name) && !asked.has(name));
  // Already asked for: wait for the token on its way, if there is one.
  if (missing.length === 0) return authorizing ?? Promise.resolve();
  for (const name of missing) asked.add(name);
  debug("authorizing for", missing.join(", "));
  return reauthorize();
}

const wanted = (name) => name.startsWith("user:") || watched.has(name);

function subscribe(name) {
  if (!client) return;
  const channel = client.channels.get(name);
  if (!handlers.has(name)) handlers.set(name, (message) => forward(name, message));
  const handler = handlers.get(name);
  // Attach first, then listen: a refused attach leaves no listener behind to double up on the retry.
  const listen = async () => {
    if (!wanted(name) || client?.channels.get(name) !== channel) return;
    await channel.attach();
    channel.unsubscribe(handler);
    await channel.subscribe(handler);
  };
  void ensure([name])
    .then(listen)
    .catch(async (error) => {
      // The token's list can be a beat behind (a DM made a moment ago): one fresh token, one more try.
      if (error?.code !== CAPABILITY_REFUSED || retried.has(name)) throw error;
      retried.add(name);
      await reauthorize();
      await listen();
    })
    .catch((error) => debug("subscribe failed", name, error?.message));
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
        try {
          granted = new Set(Object.keys(JSON.parse(body.tokenRequest.capability)));
        } catch {
          granted = null;
        }
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
  granted = null;
  asked.clear();
  retried.clear();
  handlers.clear();
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
  handlers.delete(name);
  client?.channels.get(name).unsubscribe();
  void client?.channels.get(name).detach().catch(() => {});
}

module.exports = { start, stop, reconnect, watch, unwatch, ensure, on, currentUserId: () => userId };
