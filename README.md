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

## Regular Discord: build and inject

Install Git, Node.js 22 or later, and pnpm. The pinned Vencord checkout declares its own pnpm version; use that version for reproducible builds.

On Linux or macOS:

```sh
git clone https://github.com/AhmxdNYC/discord-handheld-controls.git
cd discord-handheld-controls
node scripts/setup.mjs
```

This clones a tested Vencord revision into `.build/Vencord`, copies the plugins, installs dependencies, type-checks and builds. To open Vencord's installer for regular Discord, fully quit Discord and run:

```sh
node scripts/setup.mjs --inject
```

Choose the Discord installation in the installer. Restart Discord, open **Settings → Vencord → Plugins**, enable **HandheldControls**, and restart again. Keep this repository and its `.build/Vencord` folder: the development installation loads files from there.

For an existing Vencord checkout (including Windows):

```sh
node scripts/setup.mjs --vencord /path/to/Vencord --stage-only
cd /path/to/Vencord
pnpm install --frozen-lockfile
pnpm testTsc
pnpm build
pnpm inject
```

On Windows, substitute a quoted Windows path, such as `"C:\Users\you\Documents\Vencord"`. Automatic build/injection through this repository's wrapper is currently Linux/macOS only; staging and the manual pnpm steps work across platforms. The wrapper refuses to overwrite differing plugin files; back up edited copies or use a fresh checkout.

To uninstall the client modification, run `pnpm uninject` from the Vencord checkout and select the installation to restore. To disable only controller controls, switch off HandheldControls in the Plugins page. Discord updates can require reinjection. See [Vencord's installation documentation](https://docs.vencord.dev/installing/) for supported installation formats and troubleshooting.

## Vesktop

Build with `node scripts/setup.mjs`. In Vesktop **Settings → Vesktop Settings → Open Developer Settings → Vencord Location**, select `.build/Vencord/dist`, then fully restart Vesktop and enable HandheldControls. Flatpak needs persistent access to the checkout; for example:

```sh
flatpak override --user dev.vencord.Vesktop --filesystem="$PWD/.build/Vencord"
```

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

Plugin source is in `plugins/`. `node --test scripts/setup.test.mjs` checks staging and overwrite protection. `node scripts/setup.mjs` checks plugin types and builds against the pinned Vencord revision. CI repeats this from a clean checkout.

Before claiming support for a new client/controller, manually check section navigation, menus, channel switching, keyboard message entry, calibration, controller reconnect and plugin disable/re-enable. No automated hardware coverage is claimed. Discord UI changes can break selectors or internal APIs; pinning Vencord does not pin Discord's UI.

## Contributing and license

Include your OS, Discord/Vesktop version, Vencord revision, controller model, expected behavior and reproduction steps. Remove personal messages, account identifiers and tokens from logs and screenshots. Keep fixes focused and check types/build before submitting.

GPL-3.0-or-later; see [LICENSE](LICENSE). Vencord is a separately maintained GPL-licensed dependency. Discord and Vesktop are trademarks of their respective owners; this project is independent.
