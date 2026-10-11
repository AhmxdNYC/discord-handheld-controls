# BetterDiscord

The BetterDiscord build reuses the controller and companion plugin source in `plugins/`. `betterdiscord/host.mjs` maps settings/persistence to `BdApi.Data`, Discord module discovery to `BdApi.Webpack`, and lifecycle to BetterDiscord's plugin class interface. Each output is a standalone `.plugin.js` file with a metadata header and no runtime dependency on Vencord or npm packages.

## Install on Windows, macOS or Linux

BetterDiscord must already be installed in the Discord client you intend to use. If needed, install it through the [official BetterDiscord downloads](https://betterdiscord.app/). Use the controller plugin with the selected host; the BetterDiscord route does not invoke the Vencord injector.

With Node.js 22+ and npm installed, run from this repository:

```sh
node scripts/setup.mjs --client betterdiscord --inject
```

This installs the locked build dependencies when absent, builds three standalone plugins and copies them into BetterDiscord's existing plugin folder. Enable **HandheldControls** in Discord **Settings → BetterDiscord → Plugins**. HeldIndicator is optional; GamepadDebug is a diagnostic overlay that should normally stay disabled.

If your installation uses a different plugin folder, use BetterDiscord's **Open Plugins Folder** button to find it:

```sh
node scripts/setup.mjs --client betterdiscord --inject --plugins-dir "/path/to/BetterDiscord/plugins"
```

The default locations are `%APPDATA%/BetterDiscord/plugins` on Windows, `~/Library/Application Support/BetterDiscord/plugins` on macOS, and `${XDG_CONFIG_HOME:-~/.config}/BetterDiscord/plugins` on Linux. The installer requires the folder to exist, so it does not silently copy files into an unused directory.

## Manual installation

Run `node scripts/setup.mjs --client betterdiscord`, then copy the files from `dist/betterdiscord/` into BetterDiscord's plugin folder. CI publishes the built files as downloadable workflow artifacts for each OS. Building needs npm dependencies; using the resulting plugin files does not need Node.js or this repository.

## Update and remove

Rerun the install command to update. Differing existing plugin files are backed up under `.build/betterdiscord-backups/`. The installer records the exact copies it installed.

```sh
node scripts/setup.mjs --client betterdiscord --uninstall
```

Use the same `--plugins-dir` when you installed into a custom folder. Removal deletes only the three tracked controller plugins and refuses to delete files edited after installation. Saved settings/calibration and BetterDiscord itself remain. Disable the plugins first; if you installed manually or deleted the repository's installation records, remove them through BetterDiscord's plugin folder instead.

## Validation and limits

Tests cover persistent settings/defaults, calibration data, lazy module lookup, method binding, plugin lifecycle, bundle exports, cross-platform folder selection, installation and safe removal. All three bundles are built from shared source. CI repeats builds/tests on Windows, macOS and Linux.

This validates the adapter and artifact structure, not a logged-in BetterDiscord session with real hardware. Discord's internal navigation/message APIs can change; the adapter fails early with the missing module name if essential modules cannot be discovered. Verify navigation, menus, keyboard entry, voice shortcuts, reconnect and plugin disable/re-enable in a real client before calling runtime support verified. Game Mode scale/restart and the optional screen-feed integration remain Vesktop-specific.

References: [BetterDiscord plugin structure](https://docs.betterdiscord.app/plugins/introduction/structure), [settings](https://docs.betterdiscord.app/plugins/tutorials/settings), and [Webpack API source](https://github.com/BetterDiscord/BetterDiscord/blob/main/src/betterdiscord/api/webpack.ts).
