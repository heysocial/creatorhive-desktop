/*
  The app's own links: creatorhive://accept-invite?token=… and
  creatorhive://sign-in?email=… (creatorhive-preview:// for the Preview app).

  The website's /accept-invite/mac and /sign-in/mac pages offer them after the
  download ("Open your invite"), so an invited member lands on setup with their
  email filled in. A link is kept until the interface takes it, so one that
  starts the app is not lost while the window loads.
*/
const SCHEME_FOR = { preview: "creatorhive-preview", release: "creatorhive" };

const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;
const EMAIL = /^[^\s@]{1,128}@[^\s@]{1,125}$/;

/** A link's meaning, or null for anything this app doesn't open. */
function parseLink(raw, scheme) {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${scheme}:`) return null;
  // creatorhive://accept-invite?… parses with the action as the host.
  const action = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action === "accept-invite") {
    const token = url.searchParams.get("token")?.trim() ?? "";
    return TOKEN.test(token) ? { kind: "invite", token } : null;
  }
  if (action === "sign-in") {
    const email = url.searchParams.get("email")?.trim() ?? "";
    return EMAIL.test(email) ? { kind: "sign-in", email } : { kind: "sign-in", email: "" };
  }
  return null;
}

function createLinks({ isPreview }) {
  const scheme = isPreview ? SCHEME_FOR.preview : SCHEME_FOR.release;
  let pending = null;
  let deliver = null;

  return {
    scheme,
    /** Somewhere a link arrived (open-url, a second launch's argv). True when it was ours. */
    receive(raw) {
      const link = parseLink(raw, scheme);
      if (!link) return false;
      pending = link;
      if (deliver) deliver(link);
      return true;
    },
    /** The first argument that is one of our links (a launch's argv). */
    fromArgv(argv) {
      return Array.isArray(argv) ? argv.find((arg) => typeof arg === "string" && arg.startsWith(`${scheme}://`)) : undefined;
    },
    /** The interface asks once it has loaded; the link is handed over once. */
    take() {
      const link = pending;
      pending = null;
      return link;
    },
    /** How a link that arrives later reaches the interface (and is then taken). */
    onLink(callback) {
      deliver = callback;
    },
  };
}

module.exports = { createLinks, parseLink };
