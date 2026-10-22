#!/bin/zsh
# Runs the interface from Vite's dev server (instant reloads) inside Electron.
# Point CREATORHIVE_URL at a local copy of the site to test without real data.
set -euo pipefail
cd "${0:A:h}/.."
PORT=5199
npx vite --config renderer/vite.config.mts --port $PORT --strictPort &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null' EXIT
until curl -s -o /dev/null "http://localhost:$PORT"; do sleep 0.2; done
CREATORHIVE_RENDERER_URL="http://localhost:$PORT" npx electron .
