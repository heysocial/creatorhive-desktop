"use strict";

/*
  Pictures, voice memos and files that live behind the member's sign-in (for
  example `/api/dms/<id>/voice/<messageId>`) can't be loaded by the interface
  directly: the window has no cookies of its own. `chmedia://site/<path>` asks
  the CreatorHive server for them through the session's cookie jar instead.
  Only GETs of the CreatorHive origin are allowed.
*/

const { protocol, session } = require("electron");
const { ORIGIN, debug } = require("./config");
const { appSession } = require("./site");

const SCHEME = "chmedia";

function registerScheme() {
  // Must run before the app is ready.
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
  ]);
}

function handle() {
  const handler = async (request) => {
    const url = new URL(request.url);
    const target = `${ORIGIN}${url.pathname}${url.search}`;
    try {
      const headers = {};
      // Seeking in audio and video needs ranges passed through.
      const range = request.headers.get("range");
      if (range) headers.Range = range;
      return await appSession().fetch(target, { headers });
    } catch (error) {
      debug("media failed", target, error?.message);
      return new Response(null, { status: 502 });
    }
  };
  // The main window uses the default session; pop-out windows share it.
  session.defaultSession.protocol.handle(SCHEME, handler);
}

module.exports = { registerScheme, handle, SCHEME };
