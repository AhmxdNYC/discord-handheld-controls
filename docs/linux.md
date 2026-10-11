# Optional Linux integration

`linux/hh-pad-bridge.py` reads evdev input and forwards controller state over a local Chromium debugging connection on port 9222. It currently recognises the ROG Ally X and the Microsoft Xbox Elite device names listed in `NAMES`; other controllers may require additional mappings. Use Chromium's normal Gamepad API first.

The bridge needs Python 3, the `evdev` module and access to the controller's input device. Use your distribution's device-access configuration; do not run Discord as root. Install the module using your distribution package or a Python virtual environment.

For the existing Bazzite/Vesktop launcher setup:

```sh
mkdir -p "$HOME/.local/bin"
cp linux/hh-pad-bridge.py linux/vesktop-gamemode.sh "$HOME/.local/bin/"
chmod +x "$HOME/.local/bin/vesktop-gamemode.sh"
```

Back up any existing scripts before copying. Add `~/.local/bin/vesktop-gamemode.sh` as the Steam shortcut target, with a Gamepad layout. The launcher assumes the stable Vesktop Flatpak and requires `jq`, `awk` and a `python3` that can import `evdev`. It scales Vesktop from the plugin's Game Mode size setting and starts/stops the bridge with the app. Logs are under `~/.local/state/vesktop-gamemode/`.

The launcher enables a debugging port because the bridge needs it. Keep it local and do not expose or forward port 9222: debugging access can control the logged-in Discord renderer.

The bridge also includes an existing gamescope screen-feed workaround. It starts a GStreamer pipeline only when the plugin requests a feed in Game Mode; this requires `gst-launch-1.0`, PipeWire capture support and a configured `/dev/video0` virtual camera. The repository does not create a virtual camera or install portal overrides. Screen sharing and device mappings are hardware/session dependent and need local validation.

These scripts preserve the existing local Vesktop integration. They do not launch regular Discord or provide its injector. Regular Discord uses the build/inject steps in the README; a future regular-client launcher would need separate session and settings-path handling.
