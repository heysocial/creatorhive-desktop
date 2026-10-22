"use strict";

/*
  Everything the app says to the CreatorHive server goes through here, from the
  main process, with the session's own cookie jar. The interface never sees a
  cookie: it asks for `/api/...` over IPC and gets JSON back. That also means no
  CORS, and the same sign-in the website uses (NextAuth credentials).
*/

const { app, session } = require("electron");
const { ORIGIN, PARTITION, debug } = require("./config");

const appSession = () => session.fromPartition(PARTITION);

function configureUserAgent() {
  const ses = appSession();
  // The site recognises the app by this (lib/browser-attention.ts isMacApp).
  ses.setUserAgent(`${ses.getUserAgent()} CreatorHiveDesktop/${app.getVersion()}`);
}

/** Signed out answers 401, or is sent to the sign-in page as HTML. */
function signedOut(response) {
  if (response.status === 401) return true;
  if (response.redirected && new URL(response.url).pathname.startsWith("/sign-in")) return true;
  return !(response.headers.get("content-type") ?? "").includes("application/json");
}

function siteFetch(pathname, { method = "GET", headers = {}, body } = {}) {
  return appSession().fetch(`${ORIGIN}${pathname}`, {
    method,
    body,
    cache: "no-store",
    headers: { Accept: "application/json", Origin: ORIGIN, ...headers },
  });
}

const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

/**
 * A JSON API call on behalf of the interface. Only `/api/` paths, and never the
 * auth routes, which have their own functions below.
 */
async function apiRequest({ method = "GET", path, body } = {}) {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("/api/auth/") || path.includes("..")) {
    return { ok: false, status: 400, data: null, error: "bad_path" };
  }
  if (!METHODS.has(method)) return { ok: false, status: 400, data: null, error: "bad_method" };
  try {
    const response = await siteFetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (signedOut(response)) return { ok: false, status: 401, data: null, signedOut: true };
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    debug("api failed", path, error?.message);
    return { ok: false, status: 0, data: null, error: "offline" };
  }
}

/** The signed-in member, or null. Same shape as the website's `useSession`. */
async function getSession() {
  try {
    const response = await siteFetch("/api/auth/session");
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body?.user ? { ...body.user, expires: body.expires } : null;
  } catch {
    return undefined; // Offline: unknown, not signed out.
  }
}

async function csrfToken() {
  const response = await siteFetch("/api/auth/csrf");
  const body = await response.json();
  if (!body?.csrfToken) throw new Error("no csrf token");
  return body.csrfToken;
}

/*
  The website's sign-in page calls next-auth's `signIn("credentials")`, which
  posts this same form. `X-Auth-Return-Redirect` asks for JSON instead of a
  redirect; a failed sign-in comes back as a URL carrying `error=`.
*/
async function signIn(email, password) {
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return { ok: false, error: "missing" };
  }
  try {
    const form = new URLSearchParams({
      csrfToken: await csrfToken(),
      email: email.trim(),
      password,
      callbackUrl: `${ORIGIN}/`,
    });
    const response = await siteFetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: form.toString(),
    });
    const body = await response.json().catch(() => null);
    const url = body?.url ? new URL(body.url, ORIGIN) : null;
    if (!response.ok || !url || url.searchParams.get("error")) return { ok: false, error: "credentials" };
    const user = await getSession();
    return user ? { ok: true, user } : { ok: false, error: "credentials" };
  } catch (error) {
    debug("sign in failed", error?.message);
    return { ok: false, error: "offline" };
  }
}

async function signOut() {
  try {
    const form = new URLSearchParams({ csrfToken: await csrfToken(), callbackUrl: `${ORIGIN}/sign-in` });
    await siteFetch("/api/auth/signout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: form.toString(),
    });
  } catch (error) {
    debug("sign out request failed", error?.message);
  }
  // Whatever the server said, nothing of this account stays on the Mac.
  await appSession().clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "cachestorage"] });
  await appSession().clearCache();
}

module.exports = { appSession, configureUserAgent, siteFetch, signedOut, apiRequest, getSession, signIn, signOut };
