"use strict";

/*
  A request that died on the way (the Wi-Fi changed, the Mac slept, GitHub's
  CDN cut an HTTP/2 stream) is not a bug in CreatorHive. Admin → Bugs 01e98c3e
  (2.0.28, Nov 7): an update download ended in net::ERR_HTTP2_PROTOCOL_ERROR
  and, with nothing catching electron-updater's download promise, reached
  Bugs as an unhandled rejection. So:
    - transient() says whether an error is only that;
    - retryOnce() tries such a request once more after a short pause;
    - errors.js never reports one (the website drops most of these too,
      lib/errors/network.ts).
  Errors from Chromium's network stack (Electron's net, session.fetch,
  electron-updater) say "net::ERR_…"; Node's own fetch and https say
  "fetch failed" with a cause code, or the code itself.
*/

const CHROMIUM = /net::ERR_(?:HTTP2_\w+|QUIC_\w+|SPDY_\w+|NETWORK_CHANGED|NETWORK_IO_SUSPENDED|INTERNET_DISCONNECTED|CONNECTION_(?:RESET|CLOSED|ABORTED|REFUSED|TIMED_OUT|FAILED)|TIMED_OUT|EMPTY_RESPONSE|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|SOCKET_NOT_CONNECTED)\b/;
const NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "EHOSTUNREACH", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const WORDS = /^(?:(?:TypeError|Error): )?(?:fetch failed|socket hang up|network error|failed to fetch)$/i;

/** Whether this error only says the connection failed or timed out. */
function transient(error) {
  for (let e = error, depth = 0; e && depth < 4; e = e.cause, depth += 1) {
    if (typeof e === "string") return CHROMIUM.test(e) || WORDS.test(e.trim());
    if (e.name === "TimeoutError") return true;
    if (typeof e.code === "string" && NODE_CODES.has(e.code)) return true;
    const message = typeof e.message === "string" ? e.message : "";
    if (CHROMIUM.test(message) || WORDS.test(message.trim()) || NODE_CODES.has(message.trim())) return true;
  }
  return false;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `run()`, and once more after `delayMs` if it failed with a transient error. */
async function retryOnce(run, delayMs = 500) {
  try {
    return await run();
  } catch (error) {
    if (!transient(error)) throw error;
    await wait(delayMs);
    return run();
  }
}

module.exports = { transient, retryOnce };
