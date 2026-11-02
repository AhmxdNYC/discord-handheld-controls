# Decky installer (developer preview)

The `decky/` directory builds a Decky Loader plugin for **Linux x86-64** (Steam Deck / SteamOS and Bazzite). It installs Handheld Controls into Vesktop and can add **Discord — Handheld Controls** to the Steam library. This preview has offline tests and a production frontend build; it has **not been tested inside Decky, on Steam Deck hardware, or with the Steam shortcut API**. It is not approved for the Decky store.

## Build and package

From the repository:

```sh
cd decky
npm ci --ignore-scripts
npm run test
npm run check
npm run build
npm run package
```

The installable development ZIP is written to `dist/decky/HandheldControls-Decky.zip` at the repository root. It contains a top-level plugin folder, `plugin.json`, `package.json`, `main.py`, `dist/index.js`, and the GPL license. Install it through Decky's developer ZIP installation workflow after inspecting the source. This project does not install Decky itself.

## What it does

- **Install Vesktop** is a separate action. It uses an existing Flathub remote for a user Flatpak install (`flatpak install --user`). It never installs as root, adds repositories, or uninstalls Vesktop. If Flatpak or Flathub is missing, configure those through the operating system first.
- **Install / Update / Repair** downloads the pinned `v6.30.0` Linux release, checks its embedded expected SHA256, rejects unsafe ZIP paths/symlinks/oversized archives, verifies the manifest and each payload hash, and stages the custom Vencord build. Updates are intentionally pinned; release maintainers must update `VERSION` and `ARCHIVE_SHA256` together before publishing a new Decky build.
- The backend discovers the desktop user's home from `decky.DECKY_USER_HOME`. It supports standard Flatpak (`~/.var/app/dev.vencord.Vesktop/config/vesktop`) and native (`~/.config/vesktop`) configurations. Arbitrary portable/custom XDG paths are not yet supported. If both clients exist, Flatpak takes precedence. It uses the existing Vesktop `state.json` custom Vencord location and puts the build inside Vesktop's own configuration directory, avoiding new Flatpak filesystem overrides.
- Vesktop must be fully closed first, including its tray process. The installer will refuse a detected running `vesktop`, `vesktop.bin`, or `Vesktop` process. It does not terminate Discord or restart the desktop.
- A custom build already selected in Vesktop is replaced while this installation is active; its original location is saved for removal. Other custom plugins present only in that earlier build will not appear in the Handheld Controls build. Ordinary saved theme/plugin settings are preserved. Handheld Controls defaults to enabled for a fresh installation; an existing explicit disabled preference is preserved.
- **Add to Steam library** uses `SteamClient.Apps.AddShortcut`. Its returned ID is saved, preventing repeated additions through this plugin. A failed save removes the newly created shortcut. This is not a search of every shortcut in Steam; separately created/manual duplicates are not detected. If you manually remove the shortcut, Remove and reinstall the controls before adding it again.
- **Remove controls and shortcut** restores only the previous custom build location if the user has not changed that setting since installation. It removes checksum-matching managed files and refuses removal of edited files. Unrelated files, backups, Vesktop itself, themes, and user settings are preserved. Removing Decky or unloading this plugin does not silently remove an installed Discord setup.

## Limits and release checklist

This initial integration launches Vesktop with its normal native Gamepad input. It does not install the optional evdev controller bridge or alter Steam Input/controller layouts. Game Mode controller exposure, first sign-in, launch behavior, focus handling, multiple controllers, Steam shortcut removal, and frontend notifications still require runtime testing. No always-on background service is installed.

When testing a new ZIP: reinstalling a plugin with the same name does not reload its Python backend. Disable and re-enable the plugin (or restart Decky) after each reinstall, or the old backend keeps running.

For a public Decky release, validate the ZIP in a clean user environment and on Steam Deck/Bazzite before store submission. The official plugin database uses a repository submodule; because this plugin lives in a subdirectory of a larger repository, confirm accepted packaging/build metadata with Decky maintainers before submission rather than assuming store acceptance.

## Primary references

- [Official Decky plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template): current `@decky/api`, `@decky/ui`, Python backend and Rollup layout.
- [Decky Steam client shortcut API definitions](https://github.com/SteamDeckHomebrew/decky-frontend-lib/blob/main/src/globals/steam-client/App.ts): `AddShortcut` and `RemoveShortcut`.
- [Vesktop state schema](https://github.com/Vencord/Vesktop/blob/main/src/shared/settings.d.ts) and [custom build selection IPC](https://github.com/Vencord/Vesktop/blob/main/src/main/ipc.ts): `state.json` / `vencordDir`.
- [Decky plugin store submission instructions](https://github.com/SteamDeckHomebrew/decky-plugin-database#submit-your-plugin).
