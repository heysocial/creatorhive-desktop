#!/bin/zsh
# Builds, signs and notarizes CreatorHive for Mac.
#   scripts/build.sh                    build into dist/
#   scripts/build.sh release            build, then publish a GitHub release (scripts/publish-release.sh)
#   scripts/build.sh preview [release]  the same for "CreatorHive Preview" (prerelease)
#   ... release --dry-run               build for real, then show what publishing would do
# electron-builder only builds; it never publishes (its parallel uploads raced
# to create the release twice). publish-release.sh tags, drafts, uploads,
# verifies, and only then makes the release Latest.
# Signing uses the "Developer ID Application" identity in the login keychain.
# Notarization uses the App Store Connect API key kept outside the repo, with its
# ids in notary.env next to it (APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER).
set -euo pipefail
cd "${0:A:h}/.."
SIGNING="$HOME/.creatorhive-desktop-signing"
set -a; source "$SIGNING/notary.env"; set +a
export CSC_NAME="Simon Choucroun (Y76C9NAS53)"

CONFIG=electron-builder.yml
if [[ "${1:-}" == "preview" ]]; then
  CONFIG=electron-builder.preview.yml
  shift
fi

npm run typecheck
npm run build:renderer

npx electron-builder --config "$CONFIG" --mac --universal --publish never

if [[ "${1:-}" == "release" ]]; then
  shift
  scripts/publish-release.sh $([[ "$CONFIG" == electron-builder.preview.yml ]] && echo --preview) "$@"
fi
