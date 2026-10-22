#!/bin/zsh
# Builds, signs and notarizes CreatorHive for Mac.
#   scripts/build.sh                    build into dist/
#   scripts/build.sh release            build and publish a GitHub release (needs GH_TOKEN)
#   scripts/build.sh preview [release]  the same for "CreatorHive Preview" (prerelease)
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

if [[ "${1:-}" == "release" ]]; then
  export GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"
  npx electron-builder --config "$CONFIG" --mac --universal --publish always
  scripts/merge-release.sh "v$(node -p "require('./package.json').version")"
else
  npx electron-builder --config "$CONFIG" --mac --universal --publish never
fi
