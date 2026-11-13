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
const { retryOnce } = require("./network");

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
  // The personal video editor's originals and edited versions (presigned links the site hands out).
  /\.r2\.cloudflarestorage\.com$/,
];

/*
  Video files can be gigabytes: those stream to disk instead of being held in
  memory. Same hosts rule as download().
*/
async function downloadToFile(url, filePath) {
  const target = url.startsWith("/") ? `${ORIGIN}${url}` : url;
  const { protocol, origin, hostname } = new URL(target);
  if (origin === ORIGIN || protocol !== "https:" || !FILE_HOSTS.some((host) => host.test(hostname))) {
    fs.writeFileSync(filePath, await download(url));
    return;
  }
  const { Readable } = require("node:stream");
  const { pipeline } = require("node:stream/promises");
  const response = await fetch(target);
  if (!response.ok || !response.body) throw new Error(`download ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
}

const isLargeFileHost = (url) => {
  try {
    return /\.r2\.cloudflarestorage\.com$/.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
};

/** A site path or one of FILE_HOSTS over https, fetched with the member's cookies when it's the site. */
async function download(url) {
  const target = url.startsWith("/") ? `${ORIGIN}${url}` : url;
  const { protocol, origin, hostname } = new URL(target);
  if (origin !== ORIGIN && (protocol !== "https:" || !FILE_HOSTS.some((host) => host.test(hostname)))) {
    throw new Error("bad url");
  }
  // A connection that drops (before or during the bytes) is tried once more.
  return retryOnce(async () => {
    const response = origin === ORIGIN
      ? await siteFetch(target.slice(ORIGIN.length), { headers: { Accept: "*/*" } })
      : await fetch(target);
    if (!response.ok) throw new Error(`download ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }, 1000);
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

const VIDEO_EXT = new Set(["mov", "mp4", "m4v", "webm", "hevc", "3gp", "mkv", "avi"]);
const activePuts = new Map();

function videoFileInfo(filePath) {
  try {
    const file = String(filePath || "");
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!file || !VIDEO_EXT.has(ext)) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    return { path: file, name: path.basename(file), size: stat.size };
  } catch {
    return null;
  }
}

/*
  A file (or, for a multipart upload, one part of it: bytes [start, end)) from
  disk to a presigned R2 URL. Never read into memory, never re-encoded.
  Progress goes back as `files:putProgress` under `id`. A connection that goes
  quiet for a minute is dropped, so a dead network fails the part instead of
  hanging (the interface waits and sends that part again).
*/
function putFile(sender, id, url, type, filePath, range = null) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(String(url));
    } catch {
      resolve({ ok: false, error: "bad_url" });
      return;
    }
    if (target.protocol !== "https:" || !target.hostname.endsWith(".r2.cloudflarestorage.com")) {
      resolve({ ok: false, error: "bad_url" });
      return;
    }
    const info = videoFileInfo(filePath);
    if (!info) {
      resolve({ ok: false, error: "no_file" });
      return;
    }
    let start = 0;
    let end = info.size;
    if (range) {
      start = Number(range.start);
      end = Number(range.end);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > info.size || end <= start) {
        resolve({ ok: false, error: "bad_range" });
        return;
      }
    }
    const length = end - start;
    const https = require("node:https");
    // A part needs no Content-Type (the multipart upload already has one).
    const headers = range ? { "Content-Length": length } : { "Content-Type": String(type || "application/octet-stream"), "Content-Length": length };
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activePuts.delete(id);
      resolve(result);
    };
    const request = https.request(target, { method: "PUT", headers }, (response) => {
      response.resume();
      response.on("end", () => finish({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode }));
      response.on("error", () => finish({ ok: false, error: "failed" }));
    });
    request.setTimeout(60_000, () => request.destroy(new Error("timeout")));
    activePuts.set(id, request);
    let sent = 0;
    let lastReport = 0;
    const stream = fs.createReadStream(info.path, { start, end: end - 1, highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => {
      sent += chunk.length;
      const now = Date.now();
      if (now - lastReport > 150 || sent === length) {
        lastReport = now;
        if (!sender.isDestroyed()) sender.send("files:putProgress", { id, sent, total: length });
      }
    });
    request.on("error", (error) => {
      stream.destroy();
      debug("file put failed", error?.message);
      finish({ ok: false, error: error?.message === "cancelled" ? "cancelled" : "failed" });
    });
    stream.on("error", () => request.destroy(new Error("read_failed")));
    stream.pipe(request);
  });
}

/*
  Staff: "Download all" of a student's clips. The member picks a folder once
  (files:pickFolder); each clip is then saved under it, in sub-folders
  (<Student>/Video 1/01 - IMG_1234.MOV). Only folders picked in this run of
  the app are written to, and every path segment is cleaned, so the interface
  can't write anywhere else.
*/
const pickedFolders = new Set();
const cleanSegment = (part) => safeName(String(part || "").replace(/^\.+/, "").trim()).slice(0, 120) || "file";

async function saveInto({ folder, parts, url } = {}) {
  const root = String(folder || "");
  if (!pickedFolders.has(root)) return { ok: false, error: "bad_folder" };
  const segments = Array.isArray(parts) ? parts.slice(0, 4).map(cleanSegment) : [];
  if (!segments.length) return { ok: false, error: "bad_path" };
  const filePath = path.join(root, ...segments);
  if (!filePath.startsWith(root + path.sep)) return { ok: false, error: "bad_path" };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Into a .part file first, so a download that stops never leaves half a clip under the real name.
  const partial = `${filePath}.download`;
  try {
    await downloadToFile(String(url), partial);
    fs.renameSync(partial, filePath);
    return { ok: true, path: filePath };
  } catch (error) {
    try { fs.rmSync(partial, { force: true }); } catch { /* nothing to clean */ }
    debug("save into folder failed", error?.message);
    const status = Number(/download (\d{3})/.exec(String(error?.message))?.[1]) || undefined;
    return { ok: false, status, error: status ? "http" : "failed" };
  }
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

  /*
    UGC Starter's "Submit your 3 videos": the original file, streamed from disk
    to the presigned R2 URL the server handed out (never read into memory,
    never re-encoded). Progress goes back as `files:putProgress`.
  */
  ipcMain.handle("files:pickVideo", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a video",
      properties: ["openFile"],
      filters: [{ name: "Videos", extensions: ["mov", "mp4", "m4v", "webm", "hevc", "3gp", "mkv", "avi"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return videoFileInfo(result.filePaths[0]);
  });
  ipcMain.handle("files:videoInfo", (_event, filePath) => videoFileInfo(filePath));
  ipcMain.handle("files:putFile", (event, { id, url, type, filePath } = {}) => putFile(event.sender, String(id), url, type, filePath));
  // One part of a multipart upload: bytes [start, end) of the file.
  ipcMain.handle("files:putPart", (event, { id, url, filePath, start, end } = {}) => putFile(event.sender, String(id), url, "", filePath, { start, end }));
  ipcMain.handle("files:pickFolder", async (event, { title } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win, {
      title: typeof title === "string" ? title.slice(0, 120) : "Choose a folder",
      buttonLabel: "Save here",
      defaultPath: app.getPath("downloads"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    pickedFolders.add(result.filePaths[0]);
    return result.filePaths[0];
  });
  ipcMain.handle("files:saveInto", (_event, request) => saveInto(request));
  ipcMain.handle("files:showInFolder", (_event, filePath) => {
    const file = String(filePath || "");
    if ([...pickedFolders].some((root) => file.startsWith(root + path.sep))) shell.showItemInFolder(file);
  });
  ipcMain.on("files:putCancel", (_event, id) => {
    const request = activePuts.get(String(id));
    if (request) request.destroy(new Error("cancelled"));
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
      if (isLargeFileHost(url)) await downloadToFile(String(url), result.filePath);
      else fs.writeFileSync(result.filePath, await download(String(url)));
      shell.showItemInFolder(result.filePath);
      return { ok: true };
    } catch (error) {
      debug("save failed", error?.message);
      return { ok: false };
    }
  });

  // The interface builds the .ics; Calendar opens it and asks where to add it.
  // Several files into one folder, asked for once ("Download all 3 originals").
  ipcMain.handle("files:saveMany", async (event, { items, title } = {}) => {
    const list = Array.isArray(items) ? items.filter((item) => item && typeof item.url === "string").slice(0, 20) : [];
    if (!list.length) return { ok: false };
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win, {
        title: typeof title === "string" ? title : "Choose a folder",
        buttonLabel: "Save here",
        defaultPath: app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const folder = result.filePaths[0];
      let last = null;
      for (const item of list) {
        last = path.join(folder, safeName(item.name));
        await downloadToFile(String(item.url), last);
      }
      if (last) shell.showItemInFolder(last);
      return { ok: true };
    } catch (error) {
      debug("save many failed", error?.message);
      return { ok: false };
    }
  });

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
