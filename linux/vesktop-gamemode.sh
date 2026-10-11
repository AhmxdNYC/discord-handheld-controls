#!/bin/bash
# Launch Vesktop from Steam. In Game Mode, Discord is drawn at the size set in the HandheldControls plugin
# ("Game Mode size", default 200%); in Desktop Mode it starts normally. Always keeps the debug port for live testing.
# Steam shortcut target: ~/.local/bin/vesktop-gamemode.sh
# Log: ~/.local/state/vesktop-gamemode/latest.log

LOG_DIR="$HOME/.local/state/vesktop-gamemode"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/launch-$(date +%Y%m%d-%H%M%S).log"
ln -sf "$LOG" "$LOG_DIR/latest.log"
ls -1t "$LOG_DIR"/launch-*.log 2>/dev/null | tail -n +11 | xargs -r rm -f

SETTINGS="$HOME/.var/app/dev.vencord.Vesktop/config/vesktop/settings/settings.json"
VESKTOP_SETTINGS="$HOME/.var/app/dev.vencord.Vesktop/config/vesktop/settings.json"

# no Steam overlay / runtime libraries inside Electron
unset LD_PRELOAD

# The pad bridge: reads the controller straight from the system and hands it to the HandheldControls plugin (Vesktop's
# sandboxed Chromium can lose the controller when Bazzite reloads the controller profile). Stops when this script does.
BRIDGE_LOG="$LOG_DIR/bridge.log"
HH_BRIDGE_KEEP=1 python3 "$HOME/.local/bin/hh-pad-bridge.py" >> "$BRIDGE_LOG" 2>&1 &
BRIDGE_PID=$!
trap 'kill $BRIDGE_PID 2>/dev/null' EXIT

# Runs Vesktop; if the plugin's "Restart now" asked for a restart, starts it again (with the new size) — the launcher
# stays alive the whole time, so Steam keeps treating it as the same running app.
while true; do
  FLAGS=(--remote-debugging-port=9222)
  # Game Mode = running inside gamescope (Steam's Game Mode session)
  if [ -n "$GAMESCOPE_STATS" ] || [ "$XDG_CURRENT_DESKTOP" = "gamescope" ]; then
    PCT=$(jq -r '.plugins.HandheldControls.gameModeScale // 200' "$SETTINGS" 2>/dev/null)
    [[ "$PCT" =~ ^[0-9]+(\.[0-9]+)?$ ]] || PCT=200
    SCALE=$(awk -v p="$PCT" 'BEGIN { s = p / 100; if (s < 0.75) s = 0.75; if (s > 3) s = 3; printf "%.2f", s }')
    FLAGS+=(--force-device-scale-factor="$SCALE")
    MODE="game mode, scale $SCALE"
  else
    MODE="desktop mode, native scale"
  fi
  { echo "=== Vesktop launch: $(date) — $MODE ==="; echo "flags: ${FLAGS[*]} $*"; } >> "$LOG"

  flatpak run --branch=stable --arch=x86_64 --command=startvesktop --file-forwarding dev.vencord.Vesktop "${FLAGS[@]}" "$@" >> "$LOG" 2>&1
  echo "--- Vesktop exited ($?) at $(date) ---" >> "$LOG"

  # restart requested by the plugin?
  [ "$(jq -r '.plugins.HandheldControls.restartPending // false' "$SETTINGS" 2>/dev/null)" = "true" ] || break
  RESTORE=$(jq -r '.plugins.HandheldControls.restartRestoreTray // false' "$SETTINGS" 2>/dev/null)
  tmp=$(mktemp) && jq '.plugins.HandheldControls.restartPending = false | .plugins.HandheldControls.restartRestoreTray = false' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  if [ "$RESTORE" = "true" ]; then
    tmp=$(mktemp) && jq '.minimizeToTray = true' "$VESKTOP_SETTINGS" > "$tmp" && mv "$tmp" "$VESKTOP_SETTINGS"
  fi
  echo "--- restarting (requested from the plugin) ---" >> "$LOG"
  sleep 1
done
