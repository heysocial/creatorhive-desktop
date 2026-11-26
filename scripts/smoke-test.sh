#!/bin/zsh
# Opens the app scripts/build.sh just built and checks, before anything is
# published, that it works for a member:
#   1. it launches: the main process loads (2.0.69 didn't: "Cannot find module
#      'fs-extra'"), the window renders, and the updater checks the feed;
#   2. it refuses Chromium's remote debugging (exits, and the port never opens);
#   3. its update banner works: the same code built as version 0.0.1 finds the
#      latest published release, Squirrel stages it, and "Update ready" shows
#      in the signed-in window. (The new version isn't published yet, so the
#      banner offers the current one.)
# The window is read like a person would: a screenshot of it, and macOS's text
# recognition (scripts/smoke-window.swift). It needs Screen Recording
# permission for the terminal; a failure leaves the screenshot in dist/.
# Any failure exits non-zero, and build.sh then doesn't publish.
#
# It runs as a signed-in member, from a profile kept outside the repo
# ($SMOKE_PROFILE). Sign that profile in once (any account) with:
#   scripts/smoke-test.sh --sign-in
#
#   scripts/smoke-test.sh [--preview] [--sign-in]
# --preview: launch check only (the preview's prerelease channel has no banner check).
set -euo pipefail
cd "${0:A:h}/.."

SMOKE_PROFILE="${SMOKE_PROFILE:-$HOME/.creatorhive-desktop-signing/smoke-profile}"
PREVIEW=0 SIGN_IN=0
for arg in "$@"; do
  case "$arg" in
    --preview) PREVIEW=1 ;;
    --sign-in) SIGN_IN=1 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

say() { print -r -- "• $*"; }
fail() { print -r -- "✗ smoke test: $*" >&2; exit 1; }

# SMOKE_APP: test another build (e.g. an old release) instead of dist/.
BUILT=${SMOKE_APP:-$(print -r dist/mac-universal/*.app(N[1]))}
[[ -n "$BUILT" ]] || fail "no app in dist/mac-universal (run scripts/build.sh)"
VERSION=$(node -p "require('./package.json').version")
NAME=${BUILT:t}

# Squirrel only updates an app in an Applications folder; the copy under test
# goes in ~/Applications and is removed afterwards. Never over a real install.
TARGET="$HOME/Applications/$NAME"
# Marks the copy as ours. Kept beside the app: any file added inside the
# bundle breaks its signature, and macOS won't start it.
MARK="$HOME/Applications/.${NAME:r}.smoke-test"
[[ -e "$TARGET" && ! -e "$MARK" ]] && fail "$TARGET exists and isn't a smoke-test copy: move it first"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/creatorhive-smoke.XXXXXX")
PID=""
cleanup() {
  [[ -n "$PID" ]] && kill -9 "$PID" 2>/dev/null || true
  pkill -9 -f -- "--user-data-dir=$SMOKE_PROFILE" 2>/dev/null || true
  [[ -e "$MARK" ]] && rm -rf "$TARGET" "$MARK"
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$SMOKE_PROFILE" "$HOME/Applications"

# Installs $1 at $TARGET and starts it with the smoke profile; output in $WORK/$2.log.
start() {
  rm -rf "$TARGET"
  touch "$MARK"
  ditto "$1" "$TARGET"
  "$TARGET/Contents/MacOS/${NAME:r}" --user-data-dir="$SMOKE_PROFILE" "${@:3}" > "$WORK/$2.log" 2>&1 &
  PID=$!
}
stop() {
  # SIGKILL: a normal quit would install a staged update over the copy.
  [[ -n "$PID" ]] && kill -9 "$PID" 2>/dev/null || true
  PID=""
  pkill -9 -f -- "--user-data-dir=$SMOKE_PROFILE" 2>/dev/null || true
  sleep 1
}
swiftc -O scripts/smoke-window.swift -o "$WORK/smoke-window" 2> "$WORK/swiftc.log" || fail "couldn't build smoke-window: $(tail -3 "$WORK/swiftc.log")"
# macOS captures no window while the screen is locked: say so, rather than "the window never showed anything".
[[ "$("$WORK/smoke-window" locked -)" == locked ]] && fail "this Mac's screen is locked, so the app's window can't be read: unlock it and run again"
# The text in the app's main window now (one line each), or nothing.
read_window() {
  local id
  id=$("$WORK/smoke-window" window "$PID" 2>/dev/null) || return 0
  [[ -n "$id" ]] || return 0
  screencapture -x -o -l"$id" "$WORK/window.png" 2>/dev/null || return 0
  "$WORK/smoke-window" text "$WORK/window.png" 2>/dev/null || true
}
# Waits up to $1 seconds for a window line matching the regex $2 and prints it;
# on timeout prints what the window did show, keeps the screenshot in dist/, fails.
wait_for_window() {
  local text="" line
  for i in {1..$1}; do
    text=$(read_window)
    line=$(print -r -- "$text" | grep -E -m1 -- "$2" || true)
    [[ -n "$line" ]] && { print -r -- "$line"; return 0; }
    sleep 1
  done
  [[ -f "$WORK/window.png" ]] && cp "$WORK/window.png" dist/smoke-failure.png 2>/dev/null || true
  print -r -- "${${text//$'\n'/ | }:0:240}"
  return 1
}

if (( SIGN_IN )); then
  say "opening $VERSION with the smoke profile: sign in, then quit the app (⌘Q)"
  touch "$MARK"; rm -rf "$TARGET"; ditto "$BUILT" "$TARGET"
  "$TARGET/Contents/MacOS/${NAME:r}" --user-data-dir="$SMOKE_PROFILE"
  exit 0
fi

# ---------- 1. the built app launches ----------
say "launching $NAME $VERSION"
start "$BUILT" launch
shown=$(wait_for_window 60 '.') || fail "the window never showed anything. Main-process output: $(head -c 600 "$WORK/launch.log")"
signed_in=1
read_window | grep -qE "Welcome to CreatorHive|Forgot password" && signed_in=0
say "  window rendered ($( (( signed_in )) && echo workspace || echo sign-in))"
for i in {1..60}; do
  grep -qE "\[update\].*(is not available|Found version)" "$WORK/launch.log" && break
  sleep 1
done
grep -qE "\[update\].*(is not available|Found version)" "$WORK/launch.log" \
  || fail "the updater never checked the feed. Output: $(grep '\[update\]' "$WORK/launch.log" | tail -3)"
say "  updater checked the feed: $(grep -oE '(Update for version [^ ]+ is not available|Found version [^ ]+)' "$WORK/launch.log" | tail -1)"
(( signed_in )) || fail "the smoke profile isn't signed in, so the banner can't be checked: run scripts/smoke-test.sh --sign-in once"
stop

# ---------- 2. no remote debugging ----------
say "launching with --remote-debugging-port: it must refuse"
start "$BUILT" debug --remote-debugging-port=9339
for i in {1..30}; do
  curl -s -m 0.3 http://127.0.0.1:9339/json/version > /dev/null && fail "the remote debugging port opened: the app must refuse it (src/main/index.js)"
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$PID" 2>/dev/null && fail "the app kept running with --remote-debugging-port"
PID=""
say "  refused (exited, port never opened)"

if (( PREVIEW )); then say "launch checks passed (preview: no banner check)"; exit 0; fi

# ---------- 3. the update banner ----------
LATEST=$(curl -fsSL "https://github.com/heysocial/creatorhive-desktop/releases/latest/download/latest-mac.yml" | sed -n 's/^version: //p')
[[ -n "$LATEST" ]] || fail "couldn't read the published latest-mac.yml"
say "building this code as 0.0.1 to check it's offered $LATEST"
npx electron-builder --config electron-builder.yml --mac zip --arm64 --publish never \
  -c.extraMetadata.version=0.0.1 -c.mac.notarize=false -c.directories.output="$WORK/old" > "$WORK/build-old.log" 2>&1 \
  || fail "couldn't build the 0.0.1 copy: $(tail -5 "$WORK/build-old.log")"
start "$WORK/old/mac-arm64/$NAME" banner
for i in {1..240}; do
  grep -q "$LATEST is staged and ready to install" "$WORK/banner.log" && break
  sleep 1
done
grep -q "$LATEST is staged and ready to install" "$WORK/banner.log" \
  || fail "0.0.1 never had $LATEST ready. Updater output: $(grep '\[update\]' "$WORK/banner.log" | grep -v debug | tail -4)"
say "  $LATEST downloaded and staged by Squirrel"
banner=$(wait_for_window 30 "Update ready") || fail "no \"Update ready\" banner in the window. It shows: $banner (screenshot: dist/smoke-failure.png)"
named=$(wait_for_window 10 "Version ${LATEST//./\\.}") || fail "the banner doesn't name $LATEST. The window shows: $named (screenshot: dist/smoke-failure.png)"
say "  banner shows: \"$banner\" / \"$named\""
stop
say "smoke test passed: $VERSION launches, and its update banner works"
