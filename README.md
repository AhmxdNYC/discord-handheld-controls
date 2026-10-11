# Discord Handheld Controls

Navigate Discord with a controller and type with an on-screen keyboard. Built for an ROG Ally X running Bazzite; the main plugin reads standard controllers through Chromium's Gamepad API.

HandheldControls v5.16 is a **Vencord custom plugin**, usable in Vesktop and in the official Discord desktop client with a custom Vencord build. It is not a standalone Discord extension. This first public release preserves the existing plugin implementation; official-client hardware testing is still needed.

## Features

- Section navigation for servers, channels, messages, account controls, settings and menus.
- Lock into a section, scroll, open context menus and switch servers/channels.
- On-screen and split-stick keyboards, word suggestions and stick calibration.
- Xbox, PlayStation and Nintendo button hints, theme colours and configurable back-button actions.
- Optional `HeldIndicator` companion and `GamepadDebug` diagnostic overlay.
- Optional Linux controller bridge and Vesktop Steam Game Mode launcher.

## Windows, macOS and Linux: build and inject

Install Git and Node.js 22 or later with npm. Setup installs the exact pnpm version declared by the pinned Vencord checkout automatically; a global pnpm installation is unnecessary.

In a terminal on Windows, macOS or Linux:

```sh
git clone https://github.com/AhmxdNYC/discord-handheld-controls.git
cd discord-handheld-controls
node scripts/setup.mjs
```

This clones a tested Vencord revision into `.build/Vencord`, copies the plugins, installs dependencies, type-checks and builds. To open the native installer for regular Discord or Discord already running Vencord, fully quit Discord and run:

```sh
node scripts/setup.mjs --inject
```

Choose the Discord installation in the installer. Restart Discord, open **Settings → Vencord → Plugins**, enable **HandheldControls**, and restart again. Keep this repository and its `.build/Vencord` folder: the development installation loads files from there.

Alternatively, use the platform launcher: `Install-Windows.cmd`, `Install-macOS.command`, or `./install-linux.sh`. Each builds the plugins and opens the native installer. On macOS/Linux, run `chmod +x Install-macOS.command install-linux.sh` if the downloaded files lost executable permissions.

Select a particular channel or installation using `--branch stable`, `--branch ptb`, `--branch canary`, or `--location "path to Discord"`. Branch and location are mutually exclusive. Without either, the installer provides a picker.

```sh
node scripts/setup.mjs --client vencord --inject --branch stable
```

`--client discord` and `--client vencord` both target the official Discord application; Vencord is its plugin host. If you already have Vencord, use its source checkout to preserve your other custom plugins:

```sh
node scripts/setup.mjs --vencord /path/to/Vencord --client vencord --inject
```

You can also stage without building:

```sh
node scripts/setup.mjs --vencord /path/to/Vencord --stage-only
cd /path/to/Vencord
pnpm install --frozen-lockfile
pnpm testTsc
pnpm build
pnpm inject
```

On Windows, substitute a quoted Windows path, such as `"C:\Users\you\Documents\Vencord"`. Automatic setup and injection use the same Node command on all three operating systems. The wrapper refuses to overwrite differing plugin files; back up edited copies or use a fresh checkout. Installing a fresh custom build replaces the Vencord code used by the selected Discord installation, so use your existing checkout when you need to retain other custom plugins.

To uninstall the client modification without rebuilding, run `node scripts/setup.mjs --uninstall` and select the installation to restore. You can use the same `--branch` or `--location` selector. To disable only controller controls, switch off HandheldControls in the Plugins page. Discord updates can require reinjection. See [Vencord's installation documentation](https://docs.vencord.dev/installing/) for supported installation formats and troubleshooting.

## Vesktop

Build with `node scripts/setup.mjs --client vesktop`. In Vesktop **Settings → Vesktop Settings → Open Developer Settings → Vencord Location**, select `.build/Vencord/dist`, then fully restart Vesktop and enable HandheldControls. Flatpak needs persistent access to the checkout; for example:

```sh
flatpak override --user dev.vencord.Vesktop --filesystem="$PWD/.build/Vencord"
```

## Platform coverage

| Client | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Official Discord | Native injector | Native injector | Native injector |
| Discord with Vencord | Existing checkout or native injector | Existing checkout or native injector | Existing checkout or native injector |
| Vesktop | Custom build folder | Custom build folder | Custom build folder, optional Flatpak/Game Mode helpers |

Native installer binaries are upstream x64 on Windows/Linux and universal on macOS (Intel/Apple Silicon). Native Windows/Linux ARM builds are not supplied by upstream; the wrapper reports this explicitly. Linux Snap installs are unsupported by the upstream installer. Installation permissions and packaging can require platform-specific handling; choose a custom location when discovery misses an installation. The injector does not claim support for every third-party Discord mod.

After a build, `node scripts/inject.mjs` installs without rebuilding and `node scripts/inject.mjs --uninstall` restores the client. Both accept `--vencord`, `--branch` and `--location`. `--download-only` verifies the installer without patching. Downloads use pinned Vencord Installer v1.4.2 assets and SHA-256 digests.

## Default controls

| Button | Action |
| --- | --- |
| D-pad / left stick | Move between sections or inside the locked section |
| A / bottom face button | Lock into a section, select, or start typing |
| B / right face button | Back, close menu, stop typing, unlock |
| Y / top face button | Unlock immediately |
| X / left face button | Context menu / hold action |
| LB / RB | Previous / next server |
| LT / RT | Previous / next channel |
| Right stick | Scroll |
| L3 | Newest message |
| View | Controls guide |
| Menu | Settings (context dependent) |

In Steam, use a **Gamepad** controller layout, give the Discord window focus and press a controller button. Enable GamepadDebug temporarily if the controller is not detected.

## Optional Bazzite integration

See [Linux integration](docs/linux.md). These scripts are optional and are not installed by setup. Normal controller navigation needs neither a debug port nor the bridge. Game Mode scaling/restart and the gamescope screen-sharing workaround are Vesktop-specific integrations.

## Development and validation

Plugin source is in `plugins/`. `node --test scripts/setup.test.mjs scripts/runtime.test.mjs` checks staging, overwrite protection, platform selection, paths and failure handling. `node scripts/setup.mjs` checks plugin types and builds against the pinned Vencord revision. CI repeats tests, builds and installer download verification on Windows, macOS and Linux.

Before claiming support for a new client/controller, manually check section navigation, menus, channel switching, keyboard message entry, calibration, controller reconnect and plugin disable/re-enable. No automated hardware coverage is claimed. Discord UI changes can break selectors or internal APIs; pinning Vencord does not pin Discord's UI.

## Contributing and license

Include your OS, Discord/Vesktop version, Vencord revision, controller model, expected behavior and reproduction steps. Remove personal messages, account identifiers and tokens from logs and screenshots. Keep fixes focused and check types/build before submitting.

GPL-3.0-or-later; see [LICENSE](LICENSE). Vencord is a separately maintained GPL-licensed dependency. Discord and Vesktop are trademarks of their respective owners; this project is independent.
