#!/bin/zsh
# Publishes what scripts/build.sh put in dist/ as a GitHub release, one step at
# a time, so installed apps and the download page never see half a release:
#   1. checks: the version isn't released yet, HEAD is pushed, the files exist;
#   2. writes the update file (latest-mac.yml, or preview-mac.yml for Preview);
#   3. tags HEAD as v<version> and pushes the tag;
#   4. creates the release as a draft (invisible to the updater and the
#      download page);
#   5. uploads every file, one after another (electron-builder's parallel
#      uploads raced to create the release twice: 2.0.30, Nov 8);
#   6. checks each uploaded file's size and sha256 against dist/, and that the
#      update file reads back byte for byte;
#   7. only then publishes it: Latest for the real app, a prerelease (never
#      Latest) for Preview; and checks the latest download URL serves it.
# A failure before step 7 leaves a draft nobody can see; run it again and it
# carries on with the same draft and tag.
#
#   scripts/publish-release.sh [--preview] [--dry-run]
# --dry-run does every check and read for real and prints each write instead.
set -euo pipefail
cd "${0:A:h}/.."

REPO=heysocial/creatorhive-desktop
PREVIEW=0 DRY=0
for arg in "$@"; do
  case "$arg" in
    --preview) PREVIEW=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
if (( PREVIEW )); then
  PREFIX="CreatorHive-Preview-$VERSION-mac" UPDATE_FILE=preview-mac.yml
else
  PREFIX="CreatorHive-$VERSION-mac" UPDATE_FILE=latest-mac.yml
fi
ZIP="$PREFIX.zip" DMG="$PREFIX.dmg"
FILES=("$ZIP" "$ZIP.blockmap" "$DMG" "$DMG.blockmap" "$UPDATE_FILE")
export GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"

say() { print -r -- "• $*"; }
problems=()
stop() {
  # A dry run lists everything that would stop a real one, then carries on.
  if (( DRY )); then problems+=("$*"); print -r -- "✗ would stop: $*"; else print -r -- "✗ $*" >&2; exit 1; fi
}
# Writes to GitHub or git: run, or in a dry run printed.
write() {
  if (( DRY )); then print -r -- "  [dry run] $*"; else "$@"; fi
}

(( DRY )) && say "dry run: nothing is created, pushed or uploaded"
say "publishing $TAG ($( (( PREVIEW )) && echo "Preview prerelease" || echo "release, Latest once complete"))"

# ---------- 1. checks ----------

for f in "${FILES[@]:0:4}"; do [[ -s "dist/$f" ]] || stop "dist/$f is missing (run scripts/build.sh first)"; done
APP=$(print -r dist/mac-universal/*.app(N[1]))
if [[ -n "$APP" ]]; then
  BUILT=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || true)
  [[ "$BUILT" == "$VERSION" ]] || stop "dist/ holds $BUILT, package.json says $VERSION: build again"
  # Without it the installed app can't find its updates.
  [[ -f "$APP/Contents/Resources/app-update.yml" ]] || stop "$APP has no app-update.yml"
else
  stop "no app in dist/mac-universal"
fi

git diff --quiet HEAD -- || stop "uncommitted changes: commit the release first"
HEAD_SHA=$(git rev-parse HEAD)
git fetch -q origin
[[ -n "$(git branch -r --contains "$HEAD_SHA")" ]] || stop "HEAD ($HEAD_SHA) isn't pushed: push it first"

# A release already out for this version is never touched; a draft is carried on.
RELEASE_ID=""
existing=$(gh api "repos/$REPO/releases?per_page=50" -q ".[] | select(.tag_name==\"$TAG\") | \"\(.id) \(.draft)\"")
if [[ -n "$existing" ]]; then
  (( $(print -r -- "$existing" | wc -l) == 1 )) || stop "more than one release has $TAG: tidy them up by hand"
  read -r id draft <<< "$existing"
  if [[ "$draft" == "true" ]]; then
    RELEASE_ID=$id
    say "carrying on with draft release $RELEASE_ID"
  else
    stop "$TAG is already released"
  fi
fi

REMOTE_TAG=$(git ls-remote --tags origin "refs/tags/$TAG^{}" | cut -f1)
[[ -z "$REMOTE_TAG" ]] && REMOTE_TAG=$(git ls-remote --tags origin "refs/tags/$TAG" | cut -f1)
[[ -z "$REMOTE_TAG" || "$REMOTE_TAG" == "$HEAD_SHA" ]] || stop "$TAG on GitHub is $REMOTE_TAG, not HEAD ($HEAD_SHA)"

# ---------- 2. the update file ----------

sha512() { openssl dgst -sha512 -binary "$1" | base64; }
sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
size() { stat -f %z "$1"; }

if [[ -s "dist/$ZIP" && -s "dist/$DMG" ]]; then
  ZIP_SHA=$(sha512 "dist/$ZIP")
  cat > "dist/$UPDATE_FILE" <<EOF
version: $VERSION
files:
  - url: $ZIP
    sha512: $ZIP_SHA
    size: $(size "dist/$ZIP")
  - url: $DMG
    sha512: $(sha512 "dist/$DMG")
    size: $(size "dist/$DMG")
path: $ZIP
sha512: $ZIP_SHA
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
EOF
  say "wrote dist/$UPDATE_FILE"
fi

if (( ${#problems} )); then
  print -r -- "dry run: ${#problems} problem(s) would stop a real release; the steps it would take:"
fi

# ---------- 3. the tag ----------

if [[ -z "$REMOTE_TAG" ]]; then
  say "tagging $HEAD_SHA as $TAG"
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && [[ "$(git rev-parse "$TAG^{commit}")" != "$HEAD_SHA" ]] && stop "local tag $TAG isn't HEAD"
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || write git tag "$TAG" "$HEAD_SHA"
  write git push -q origin "refs/tags/$TAG"
elif [[ "$REMOTE_TAG" == "$HEAD_SHA" ]]; then
  say "$TAG is already on GitHub at HEAD"
fi

# ---------- 4. the draft ----------

if [[ -z "$RELEASE_ID" ]]; then
  say "creating draft release $TAG"
  if (( DRY )); then
    write gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$VERSION" -F draft=true -F prerelease=$( (( PREVIEW )) && echo true || echo false )
    RELEASE_ID="<new draft id>"
  else
    RELEASE_ID=$(gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$VERSION" \
      -F draft=true -F prerelease=$( (( PREVIEW )) && echo true || echo false ) -q .id)
    say "draft release $RELEASE_ID"
  fi
fi

# ---------- 5. uploads, one at a time ----------

asset_id() { # the id of an asset by name on the draft, or nothing
  [[ "$RELEASE_ID" == "<"* ]] && return 0
  gh api "repos/$REPO/releases/$RELEASE_ID/assets?per_page=100" -q ".[] | select(.name==\"$1\") | .id"
}

upload() {
  local name=$1 file="dist/$1" attempt old
  for attempt in 1 2 3; do
    # A half-finished or older copy is removed first, so the upload never clashes.
    old=$(asset_id "$name")
    [[ -n "$old" ]] && write gh api -X DELETE "repos/$REPO/releases/assets/$old"
    say "uploading $name ($(( $(size "$file" 2>/dev/null || echo 0) / 1024 / 1024 )) MB)$( (( attempt > 1 )) && echo ", try $attempt")"
    if (( DRY )); then
      write curl -X POST "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$name" --data-binary "@$file"
      return 0
    fi
    if curl -sS --fail -o /dev/null -X POST \
      -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@$file" \
      "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$name"; then
      return 0
    fi
    sleep $(( attempt * 5 ))
  done
  stop "couldn't upload $name; the draft stays hidden, run this again to carry on"
}

for f in "${FILES[@]}"; do upload "$f"; done

# ---------- 6. verify ----------

say "checking every file on the draft against dist/"
if (( DRY )); then
  for f in "${FILES[@]}"; do
    [[ -f "dist/$f" ]] && print -r -- "  [dry run] would expect $f: $(size "dist/$f") bytes, sha256:$(sha256 "dist/$f")"
  done
  print -r -- "  [dry run] would download $UPDATE_FILE back from the draft and compare it byte for byte"
else
  assets=$(gh api "repos/$REPO/releases/$RELEASE_ID/assets?per_page=100" -q '.[] | "\(.name) \(.size) \(.state) \(.digest // "")"')
  for f in "${FILES[@]}"; do
    line=$(print -r -- "$assets" | awk -v n="$f" '$1==n')
    [[ -n "$line" ]] || stop "$f isn't on the draft"
    read -r _ rsize rstate rdigest <<< "$line"
    [[ "$rstate" == "uploaded" ]] || stop "$f is $rstate on GitHub, not uploaded"
    [[ "$rsize" == "$(size "dist/$f")" ]] || stop "$f is $rsize bytes on GitHub, $(size "dist/$f") here"
    if [[ -n "$rdigest" ]]; then
      [[ "$rdigest" == "sha256:$(sha256 "dist/$f")" ]] || stop "$f's checksum on GitHub doesn't match dist/"
    fi
    say "  ✓ $f"
  done
  # The update file is what every installed app reads: check it as it will be served.
  yml_id=$(asset_id "$UPDATE_FILE")
  gh api -H "Accept: application/octet-stream" "repos/$REPO/releases/assets/$yml_id" > "dist/.served-$UPDATE_FILE"
  cmp -s "dist/.served-$UPDATE_FILE" "dist/$UPDATE_FILE" || stop "$UPDATE_FILE on the draft differs from dist/"
  rm -f "dist/.served-$UPDATE_FILE"
  extra=$(print -r -- "$assets" | awk '{print $1}' | grep -vxF -f <(print -rl -- "${FILES[@]}") || true)
  [[ -z "$extra" ]] || stop "the draft has files this release doesn't make: $extra"
fi

# ---------- 7. publish ----------

if (( PREVIEW )); then
  say "publishing as a prerelease (never Latest)"
  write gh api -X PATCH "repos/$REPO/releases/$RELEASE_ID" -F draft=false -F prerelease=true -f make_latest=false
else
  say "publishing as Latest"
  write gh api -X PATCH "repos/$REPO/releases/$RELEASE_ID" -F draft=false -F prerelease=false -f make_latest=true
fi

if (( DRY )); then
  (( PREVIEW )) || print -r -- "  [dry run] would check releases/latest is $TAG and serves $UPDATE_FILE for $VERSION"
  if (( ${#problems} )); then
    print -r -- "dry run finished: ${#problems} problem(s) above would have stopped it"; exit 1
  fi
  print -r -- "dry run finished: a real run would publish $TAG"
  exit 0
fi

if (( ! PREVIEW )); then
  latest=$(gh api "repos/$REPO/releases/latest" -q .tag_name)
  [[ "$latest" == "$TAG" ]] || stop "published, but GitHub's Latest is $latest"
  served=$(curl -sfL "https://github.com/$REPO/releases/latest/download/$UPDATE_FILE" | head -1)
  [[ "$served" == "version: $VERSION" ]] || print -r -- "! the latest download URL still says \"$served\" (GitHub's cache; it catches up within minutes)"
fi
say "released $TAG: https://github.com/$REPO/releases/tag/$TAG"
