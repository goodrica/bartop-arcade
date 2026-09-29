#!/usr/bin/env bash
# Start the Bartop Arcade full screen on Ubuntu (or any Linux desktop).
#
# What it does:
#   1. Starts a tiny local web server (python3) for this folder.
#   2. Opens the game in a browser in kiosk mode (full screen, no toolbars).
#   3. Stops the web server again when the browser closes.
#
# Usage:
#   ./scripts/start-arcade.sh            # kiosk mode (for the bartop)
#   ./scripts/start-arcade.sh --window   # normal window (for testing)
#
# Settings you can override:
#   ARCADE_PORT=8080      port for the local web server
#   ARCADE_BROWSER=...    force a browser command, e.g. firefox
#
# See docs/ubuntu-setup.md for the full guide.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${ARCADE_PORT:-8080}"
URL="http://127.0.0.1:${PORT}/index.html"
MODE="kiosk"
[[ "${1:-}" == "--window" ]] && MODE="window"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is missing. Install it with: sudo apt install python3" >&2
  exit 1
fi

# ── 1. Web server ────────────────────────────────────────────────────────────
# The game uses JavaScript modules, which browsers refuse to load from a
# file:// page, so a local server is required (double-clicking index.html
# gives a black screen).
SERVER_PID=""
if curl -fsS -o /dev/null "$URL" 2>/dev/null; then
  echo "A server is already answering on port ${PORT}; reusing it."
else
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
  SERVER_PID=$!
  trap '[[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "$URL" 2>/dev/null && break
    sleep 0.1
  done
  if ! curl -fsS -o /dev/null "$URL" 2>/dev/null; then
    echo "The web server did not start on port ${PORT}. Try ARCADE_PORT=8090 $0" >&2
    exit 1
  fi
fi
echo "Serving ${ROOT} at ${URL}"

# ── 2. Browser ───────────────────────────────────────────────────────────────
BROWSER="${ARCADE_BROWSER:-}"
if [[ -z "$BROWSER" ]]; then
  for b in chromium chromium-browser google-chrome google-chrome-stable firefox; do
    if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
  done
fi
if [[ -z "$BROWSER" ]]; then
  echo "No browser found. Install one with: sudo snap install chromium" >&2
  exit 1
fi

# Use a separate browser profile, so kiosk mode works even if the browser is
# already open, and your everyday browser settings are left alone.
# Ubuntu's Chromium is a snap, which may only write inside ~/snap/chromium.
if [[ "$BROWSER" == chromium* ]] && command -v snap >/dev/null 2>&1 \
    && snap list chromium >/dev/null 2>&1; then
  PROFILE="${HOME}/snap/chromium/common/bartop-arcade-profile"
else
  PROFILE="${HOME}/.local/share/bartop-arcade/browser-profile"
fi
mkdir -p "$PROFILE"

echo "Launching ${BROWSER} (${MODE} mode). Close it with Alt+F4."
case "$BROWSER" in
  *firefox*)
    if [[ "$MODE" == "kiosk" ]]; then
      "$BROWSER" --kiosk "$URL"
    else
      "$BROWSER" --new-window "$URL"
    fi
    ;;
  *)
    ARGS=(
      --no-first-run
      --noerrdialogs
      --disable-infobars
      --disable-session-crashed-bubble
      --disable-translate
      --disable-pinch
      --overscroll-history-navigation=0
      # Let the sound effects play without waiting for a first tap.
      --autoplay-policy=no-user-gesture-required
      --user-data-dir="$PROFILE"
    )
    if [[ "$MODE" == "kiosk" ]]; then
      ARGS+=(--kiosk --app="$URL")
    else
      ARGS+=(--window-size=1920,1080 --app="$URL")
    fi
    "$BROWSER" "${ARGS[@]}"
    ;;
esac
