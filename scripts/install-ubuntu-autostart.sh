#!/usr/bin/env bash
# Make the Bartop Arcade start by itself when this Ubuntu user logs in.
#
# What it does (only for the current user, no sudo needed):
#   1. Adds ~/.config/autostart/bartop-arcade.desktop, which runs
#      scripts/start-arcade.sh at login.
#   2. Adds a "Bartop Arcade" icon to the app menu.
#   3. Turns off screen blanking, the lock screen, and sleep-on-idle
#      (GNOME settings), so the bartop screen stays on.
#
# Undo everything:
#   ./scripts/install-ubuntu-autostart.sh --remove
#
# See docs/ubuntu-setup.md for the full guide.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTOSTART="${HOME}/.config/autostart/bartop-arcade.desktop"
APPMENU="${HOME}/.local/share/applications/bartop-arcade.desktop"

has_gsettings() { command -v gsettings >/dev/null 2>&1; }

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$AUTOSTART" "$APPMENU"
  if has_gsettings; then
    gsettings reset org.gnome.desktop.session idle-delay 2>/dev/null || true
    gsettings reset org.gnome.desktop.screensaver lock-enabled 2>/dev/null || true
    gsettings reset org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 2>/dev/null || true
  fi
  echo "Removed Bartop Arcade autostart and restored screen settings."
  exit 0
fi

chmod +x "$ROOT/scripts/start-arcade.sh"
mkdir -p "$(dirname "$AUTOSTART")" "$(dirname "$APPMENU")"

write_desktop() {
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Name=Bartop Arcade
Comment=Touchscreen arcade (Photo Hunt)
Exec="$ROOT/scripts/start-arcade.sh"
Path=$ROOT
Icon=applications-games
Terminal=false
Categories=Game;
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF
}
write_desktop "$AUTOSTART"
write_desktop "$APPMENU"
echo "Autostart added: $AUTOSTART"
echo "App menu icon added: $APPMENU"

SCREEN_OK=false
if has_gsettings \
    && gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null \
    && gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null \
    && gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null; then
  SCREEN_OK=true
fi
if $SCREEN_OK; then
  echo "Screen blanking, lock screen, and idle sleep turned off."
else
  echo "WARNING: could not change screen settings automatically (not GNOME?)."
  echo "  Turn off Screen Blank, Automatic Screen Lock and Automatic Suspend"
  echo "  by hand in Settings > Power and Settings > Privacy > Screen."
fi

echo
echo "Done. Log out and back in (or reboot) and the arcade should open full screen."
echo "To start it right now: $ROOT/scripts/start-arcade.sh"
