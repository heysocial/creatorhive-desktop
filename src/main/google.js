"use strict";

/*
  Continue with Google.

  Google won't sign anyone in inside an app's own window, so the Mac's browser
  does it (the server side is lib/auth/app-handoff.ts in the web app):

  1. Listen on 127.0.0.1 at a free port, for one request.
  2. Open the site's /api/app-sign-in/start in the browser, with that address,
     a random `state` and a PKCE challenge.
  3. The member signs in with Google there. The site sends the browser back to
     the address with a one-time code.
  4. Trade the code and the PKCE verifier for the session cookie, and put it in
     the app's cookie jar, exactly where a password sign-in leaves it.
*/

const crypto = require("node:crypto");
const http = require("node:http");
const { shell } = require("electron");
const { ORIGIN, debug } = require("./config");
const site = require("./site");

/** Long enough to pick an account and type a password; then it gives up. */
const TIMEOUT_MS = 5 * 60 * 1000;

let pending = null;

const base64url = (buffer) => buffer.toString("base64url");

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif; }
  main { max-width: 360px; text-align: center; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { margin: 0; opacity: .7; }
</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

/** Starting again (a second click) abandons the first attempt. */
function cancel() {
  if (!pending) return;
  pending.finish({ ok: false, error: "cancelled" });
}

/**
 * Resolves with the same shape as a password sign-in: `{ ok, user }` or
 * `{ ok: false, error }`, where error is "no-account", "cancelled", "timeout",
 * "offline" or "failed".
 */
function signInWithGoogle({ onReturn } = {}) {
  cancel();

  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(24));

  return new Promise((resolve) => {
    const server = http.createServer();
    let timer = null;
    let redirectUri = null;

    const attempt = {
      finish(result) {
        if (pending !== attempt) return;
        pending = null;
        clearTimeout(timer);
        // Let the browser's tab finish loading its page before the socket goes.
        setTimeout(() => server.close(), 1000);
        resolve(result);
      },
    };
    pending = attempt;

    server.on("request", async (request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const reply = (title, body) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(page(title, body));
      };
      // Anything without our state is not the reply to this attempt.
      if (url.searchParams.get("state") !== state) {
        reply("This sign-in link is out of date", "Go back to CreatorHive and choose Continue with Google again.");
        return;
      }
      onReturn?.();

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        reply(
          error === "no-account" ? "No CreatorHive account uses that Google email" : "Google sign-in didn't finish",
          "Go back to CreatorHive to try again or sign in with your email and password.",
        );
        attempt.finish({ ok: false, error: error === "no-account" ? "no-account" : "failed" });
        return;
      }

      const result = await exchange(code, verifier, redirectUri);
      if (result.ok) reply("You're signed in", "You can close this tab and go back to CreatorHive.");
      else reply("Google sign-in didn't finish", "Go back to CreatorHive and try again.");
      attempt.finish(result);
    });

    server.on("error", (error) => {
      debug("google listener failed", error?.message);
      attempt.finish({ ok: false, error: "failed" });
    });

    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      const start = new URL("/api/app-sign-in/start", ORIGIN);
      start.search = new URLSearchParams({
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      timer = setTimeout(() => attempt.finish({ ok: false, error: "timeout" }), TIMEOUT_MS);
      shell.openExternal(start.toString());
    });
  });
}

async function exchange(code, verifier, redirectUri) {
  try {
    const response = await site.siteFetch("/api/app-sign-in/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) return { ok: false, error: "failed" };

    const origin = new URL(ORIGIN);
    await site.appSession().cookies.set({
      url: ORIGIN,
      name: body.cookieName,
      value: body.cookieValue,
      path: "/",
      secure: origin.protocol === "https:",
      httpOnly: true,
      sameSite: "lax",
      expirationDate: Math.floor(body.expiresAt / 1000),
    });
    const user = await site.getSession();
    return user ? { ok: true, user } : { ok: false, error: "failed" };
  } catch (error) {
    debug("google exchange failed", error?.message);
    return { ok: false, error: "offline" };
  }
}

/** Whether the server offers Google yet; the button stays hidden until it does. */
async function googleAvailable() {
  try {
    const response = await site.siteFetch("/api/auth/providers");
    const body = await response.json().catch(() => null);
    return Boolean(body?.google);
  } catch {
    return false;
  }
}

module.exports = { signInWithGoogle, cancelGoogle: cancel, googleAvailable };
