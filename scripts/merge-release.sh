#!/bin/zsh
# electron-builder uploads in parallel and can create the same GitHub release
# twice. Keeps the release that has preview-mac.yml / latest-mac.yml, moves any
# file only the other one got, and deletes the stray one.
#   scripts/merge-release.sh v2.0.0-preview.4
set -euo pipefail
cd "${0:A:h}/.."
TAG="$1"
REPO=heysocial/creatorhive-desktop
IDS=(${(f)"$(gh api "repos/$REPO/releases?per_page=20" -q ".[] | select(.tag_name==\"$TAG\") | .id")"})
(( ${#IDS} <= 1 )) && { echo "one release for $TAG"; exit 0; }
KEEP=""
for id in $IDS; do
  if gh api "repos/$REPO/releases/$id" -q '[.assets[].name] | join(" ")' | grep -qE '(preview|latest)-mac\.yml'; then KEEP=$id; fi
done
[[ -z "$KEEP" ]] && { echo "no release has the update file"; exit 1; }
for id in $IDS; do
  [[ "$id" == "$KEEP" ]] && continue
  # Delete first: with two releases on one tag, an upload by tag may land on the wrong one.
  NAMES=(${(f)"$(gh api "repos/$REPO/releases/$id" -q '.assets[].name')"})
  gh api -X DELETE "repos/$REPO/releases/$id"
  echo "removed duplicate release $id"
  for name in $NAMES; do
    [[ -f "dist/$name" ]] && gh release upload "$TAG" -R "$REPO" "dist/$name" --clobber
  done
done
