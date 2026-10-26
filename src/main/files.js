"use strict";

/*
  Files in and out of the Mac: uploads (drag and drop, paste, the + button),
  Quick Look, saving a file to Downloads, and handing an event to Calendar.

  Uploads use the website's own Vercel Blob routes (`/api/upload`,
  `/api/upload/feed-attachments`, ...): the route hands out a short-lived
  client token for the signed-in member, and the file goes straight to Blob.
*/

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");
const { siteFetch, signedOut } = require("./site");
const { ORIGIN, debug } = require("./config");

const UPLOAD_ROUTES = [
  /^\/api\/upload(\/(feed-attachments|hey-social))?$/,
  /^\/api\/hub\/deals\/[0-9a-f-]{36}\/briefs\/upload$/,
  /^\/api\/resources\/pages\/[0-9a-f-]{36}\/files\/upload$/,
  /^\/api\/invoice-profile\/logo\/upload$/,
];
const MAX_BYTES = 200 * 1024 * 1024;

const safeName = (name) => String(name || "file").replace(/[/\\:\0]/g, "-").slice(0, 120) || "file";

async function clientToken(route, pathname, clientPayload = null) {
  const response = await siteFetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname, clientPayload, multipart: false } }),
  });
  if (signedOut(response)) throw Object.assign(new Error("signed out"), { code: "signed_out" });
  const body = await response.json().catch(() => null);
  // Over the daily upload limit: keep the website's sentence for the interface.
  if (response.status === 429 && body?.code === "rate_limited" && typeof body.error === "string") {
    throw Object.assign(new Error(body.error), { code: "rate_limited", message: body.error });
  }
  if (!response.ok || !body?.clientToken) throw Object.assign(new Error(body?.error || `token ${response.status}`), { code: "refused" });
  return body.clientToken;
}

async function upload({ route, name, type, bytes, access, clientPayload } = {}) {
  if (typeof route !== "string" || !UPLOAD_ROUTES.some((r) => r.test(route))) return { ok: false, error: "bad_route" };
  if (!(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return { ok: false, error: "no_file" };
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? bytes : bytes.buffer);
  if (buffer.length > MAX_BYTES) return { ok: false, error: "too_big" };
  try {
    const { put } = await import("@vercel/blob/client");
    // Some routes want a folder in the name (briefs/<dealId>/…); never anything that climbs out.
    const pathname = String(name || "file").split("/").filter((part) => part && part !== "." && part !== "..").map(safeName).join("/") || "file";
    const token = await clientToken(route, pathname, typeof clientPayload === "string" ? clientPayload : null);
    const blob = await put(pathname, buffer, {
      // Resources files live in a private store; everything else is public, as on the website.
      access: access === "private" ? "private" : "public",
      token,
      contentType: typeof type === "string" && type ? type : undefined,
    });
    return { ok: true, url: blob.url, pathname: blob.pathname, contentType: blob.contentType, size: buffer.length };
  } catch (error) {
    debug("upload failed", error?.message);
    return { ok: false, error: error?.code ?? "failed", ...(error?.code === "rate_limited" ? { message: error.message } : {}) };
  }
}

/*
  Where a file the interface opens or saves may come from: the site itself, our
  file storage, and the video and GIF hosts messages and posts point at. The
  server only accepts attachments from these, so anything else is a link that
  shouldn't be fetched from this Mac.
*/
const FILE_HOSTS = [
  /\.blob\.vercel-storage\.com$/,
  /(^|\.)mux\.com$/,
  /(^|\.)videodelivery\.net$/,
  /\.cloudflarestream\.com$/,
  /^(media\d?|i)\.giphy\.com$/,
];

/** A site path or one of FILE_HOSTS over https, fetched with the member's cookies when it's the site. */
async function download(url) {
  const target = url.startsWith("/") ? `${ORIGIN}${url}` : url;
  const { protocol, origin, hostname } = new URL(target);
  if (origin !== ORIGIN && (protocol !== "https:" || !FILE_HOSTS.some((host) => host.test(hostname)))) {
    throw new Error("bad url");
  }
  const response = origin === ORIGIN
    ? await siteFetch(target.slice(ORIGIN.length), { headers: { Accept: "*/*" } })
    : await fetch(target);
  if (!response.ok) throw new Error(`download ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/*
  Folders made for Quick Look and Add to Calendar. A private DM attachment
  shouldn't stay readable in the temp folder, so each is removed a while after
  it's made (Quick Look and Calendar have read it by then) and all of them when
  the app quits.
*/
const TEMP_LIFETIME_MS = 10 * 60 * 1000;
const tempDirs = new Map();

function makeTempDir() {
  const now = Date.now();
  for (const [dir, madeAt] of tempDirs) {
    if (now - madeAt > TEMP_LIFETIME_MS) removeTempDir(dir);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creatorhive-"));
  tempDirs.set(dir, now);
  return dir;
}

function removeTempDir(dir) {
  tempDirs.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    debug("temp clean-up failed", error?.message);
  }
}

app.on("will-quit", () => {
  for (const dir of [...tempDirs.keys()]) removeTempDir(dir);
});

async function toTemp(url, name) {
  const dir = makeTempDir();
  const file = path.join(dir, safeName(name));
  fs.writeFileSync(file, await download(url));
  return file;
}

function configure(ipcMain) {
  ipcMain.handle("files:upload", (_event, request) => upload(request));

  // A video's bytes straight to Mux's upload URL (the server hands it out for this one file).
  ipcMain.handle("files:putVideo", async (_event, { url, type, bytes } = {}) => {
    try {
      const { protocol, hostname } = new URL(String(url));
      if (protocol !== "https:" || !(hostname.endsWith(".mux.com") || hostname === "storage.googleapis.com")) return { ok: false, error: "bad_url" };
      const response = await fetch(String(url), { method: "PUT", headers: { "Content-Type": String(type || "application/octet-stream") }, body: Buffer.from(bytes) });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      debug("video put failed", error?.message);
      return { ok: false, error: "failed" };
    }
  });

  ipcMain.handle("files:quickLook", async (event, { url, name } = {}) => {
    try {
      const file = await toTemp(String(url), name);
      BrowserWindow.fromWebContents(event.sender)?.previewFile(file, safeName(name));
      return { ok: true };
    } catch (error) {
      debug("quick look failed", error?.message);
      return { ok: false };
    }
  });

  ipcMain.handle("files:save", async (event, { url, name } = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("downloads"), safeName(name)) });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(result.filePath, await download(String(url)));
      shell.showItemInFolder(result.filePath);
      return { ok: true };
    } catch (error) {
      debug("save failed", error?.message);
      return { ok: false };
    }
  });

  // The interface builds the .ics; Calendar opens it and asks where to add it.
  ipcMain.handle("files:addToCalendar", async (_event, { ics, name } = {}) => {
    if (typeof ics !== "string" || !ics.startsWith("BEGIN:VCALENDAR") || ics.length > 20_000) return { ok: false };
    const dir = makeTempDir();
    const file = path.join(dir, `${safeName(name).replace(/\.ics$/i, "")}.ics`);
    fs.writeFileSync(file, ics);
    const error = await shell.openPath(file);
    return { ok: !error };
  });
}

module.exports = { configure, upload };
