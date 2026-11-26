#!/bin/zsh
# Opens the app scripts/build.sh just built and checks, before anything is
# published, that it works for a member:
#   1. it launches: the main process loads (2.0.69 didn't: "Cannot find module
#      'fs-extra'"), the window renders, and the updater checks the feed;
#   2. its update banner works: the same code built as version 0.0.1 finds the
#      latest published release, Squirrel stages it, and "Update ready" shows
#      in the signed-in window. (The new version isn't published yet, so the
#      banner offers the current one.)
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
PORT=9339
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
  "$TARGET/Contents/MacOS/${NAME:r}" --user-data-dir="$SMOKE_PROFILE" --remote-debugging-port=$PORT > "$WORK/$2.log" 2>&1 &
  PID=$!
}
stop() {
  # SIGKILL: a normal quit would install a staged update over the copy.
  [[ -n "$PID" ]] && kill -9 "$PID" 2>/dev/null || true
  PID=""
  pkill -9 -f -- "--user-data-dir=$SMOKE_PROFILE" 2>/dev/null || true
  sleep 1
}
window() { node scripts/smoke-cdp.mjs $PORT "$1" "$2"; }
WORKSPACE="document.querySelector('div.app') ? 'workspace' : ''"
RENDERED="document.querySelector('div.app') ? 'workspace' : document.querySelector('.signin-card, .signin-form') ? 'sign-in' : ''"

if (( SIGN_IN )); then
  say "opening $VERSION with the smoke profile: sign in, then quit the app (⌘Q)"
  touch "$MARK"; rm -rf "$TARGET"; ditto "$BUILT" "$TARGET"
  "$TARGET/Contents/MacOS/${NAME:r}" --user-data-dir="$SMOKE_PROFILE"
  exit 0
fi

# ---------- 1. the built app launches ----------
say "launching $NAME $VERSION"
start "$BUILT" launch
shown=$(window 60 "$RENDERED") || fail "the window never rendered ($shown). Main-process output: $(head -c 600 "$WORK/launch.log")"
say "  window rendered ($shown)"
for i in {1..60}; do
  grep -qE "\[update\].*(is not available|Found version)" "$WORK/launch.log" && break
  sleep 1
done
grep -qE "\[update\].*(is not available|Found version)" "$WORK/launch.log" \
  || fail "the updater never checked the feed. Output: $(grep '\[update\]' "$WORK/launch.log" | tail -3)"
say "  updater checked the feed: $(grep -oE '(Update for version [^ ]+ is not available|Found version [^ ]+)' "$WORK/launch.log" | tail -1)"
[[ "$shown" == workspace ]] || fail "the smoke profile isn't signed in, so the banner can't be checked: run scripts/smoke-test.sh --sign-in once"
stop

if (( PREVIEW )); then say "launch check passed (preview: no banner check)"; exit 0; fi

# ---------- 2. the update banner ----------
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
banner=$(window 30 "(document.querySelector('.update-banner')?.innerText || '').replace(/\\s+/g, ' ').trim()") \
  || fail "no update banner in the window ($banner)"
[[ "$banner" == *"$LATEST"* ]] || fail "the banner doesn't name $LATEST: \"$banner\""
say "  banner shows: \"$banner\""
stop
say "smoke test passed: $VERSION launches, and its update banner works"
