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

/**
 * Signed out answers 401, or is sent to the sign-in page. Anything else that
 * isn't JSON (a 404 page for a route this server doesn't have yet, a 502 from
 * the host) is an error for that one request, never a reason to sign out.
 */
function signedOut(response) {
  if (response.status === 401) return true;
  return response.redirected && new URL(response.url).pathname.startsWith("/sign-in");
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

/** Whether a session cookie is still saved (the server decides if it's valid). */
async function hasSessionCookie() {
  const cookies = await appSession().cookies.get({ url: ORIGIN }).catch(() => []);
  return cookies.some((cookie) => cookie.name.endsWith("session-token"));
}

/**
 * The signed-in member, or null. Same shape as the website's `useSession`.
 * Undefined when the server can't be reached (offline, or the host is down)
 * and a session is saved: unknown, not signed out.
 */
async function getSession() {
  try {
    const response = await siteFetch("/api/auth/session");
    if (response.status >= 500) return (await hasSessionCookie()) ? undefined : null;
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body?.user ? { ...body.user, expires: body.expires } : null;
  } catch {
    return (await hasSessionCookie()) ? undefined : null;
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

/**
 * A streamed POST (the Script Writer's newline-delimited JSON). Each line goes
 * to onLine as it arrives; the promise settles when the stream ends.
 */
async function apiStream({ path, body } = {}, onLine) {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("..")) return { ok: false, status: 400, error: "bad_path" };
  try {
    const response = await siteFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (response.status === 401) return { ok: false, status: 401, signedOut: true };
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.includes("ndjson")) {
      const data = await response.json().catch(() => null);
      return { ok: false, status: response.status, data };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer.trim());
    return { ok: true, status: response.status };
  } catch (error) {
    debug("stream failed", path, error?.message);
    return { ok: false, status: 0, error: "offline" };
  }
}

const FORM_ROUTES = [/^\/api\/profile\/avatar$/, /^\/api\/(dms|channels)\/[0-9a-f-]{36}\/voice$/];

/** A one-file multipart upload to a site route (the profile photo, a voice memo), with any extra text fields. */
async function uploadForm({ path, field, name, type, bytes, fields } = {}) {
  if (typeof path !== "string" || !FORM_ROUTES.some((r) => r.test(path)) || typeof field !== "string") return { ok: false, error: "bad_path" };
  try {
    const form = new FormData();
    form.append(field, new Blob([Buffer.from(bytes)], { type: String(type || "application/octet-stream") }), String(name || "file"));
    for (const [key, value] of Object.entries(fields && typeof fields === "object" ? fields : {})) {
      if (typeof value === "string") form.append(key, value);
    }
    const response = await appSession().fetch(`${ORIGIN}${path}`, { method: "POST", body: form, headers: { Origin: ORIGIN, Accept: "application/json" } });
    const data = await response.json().catch(() => null);
    // The failure's body too: a rate limit says how long to wait (retryAfterSeconds).
    return response.ok ? { ok: true, data } : { ok: false, error: data?.error ?? `HTTP ${response.status}`, data };
  } catch (error) {
    debug("upload form failed", error?.message);
    return { ok: false, error: "offline" };
  }
}

module.exports = { apiStream, uploadForm, appSession, configureUserAgent, siteFetch, signedOut, apiRequest, getSession, signIn, signOut };
