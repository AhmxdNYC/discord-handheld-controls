Handheld Controls — downloadable installer

1. Download the ZIP for your operating system and extract the whole folder.
2. Fully quit Discord.
3. Launch the installer:
   Windows: double-click HandheldControls-Installer.exe.
   macOS: double-click Install.command (choose Intel or Apple Silicon download).
   Linux: open Install.desktop, or run Install.sh. Your file manager may require
   marking the launcher executable/trusted or choosing Run in Terminal.
4. Choose regular Discord/Vencord, BetterDiscord, Vesktop, or removal.

No Node.js, npm, Git or build tools are needed. Built plugins and Vencord's
verified native installer are included. The Discord installer may contact its
upstream release service during startup, so internet access can still be needed.

Regular Discord/Vencord:
Choose the Discord installation in the native installer. Restart Discord.
HandheldControls is enabled by default on first installation.
Stable/PTB/Canary and custom installation selection use Vencord's installer.
This uses the bundled Vencord build. Users with additional custom Vencord plugins
should use the source setup with their existing checkout to preserve those plugins.
For permissions errors on a system installation, follow the native installer's
instructions. The launcher does not silently elevate itself.

BetterDiscord:
BetterDiscord must already be installed. The launcher copies the standalone
plugins into its existing plugin folder; enter a custom folder if needed.
The installer enables HandheldControls; restart Discord. HeldIndicator is
optional; GamepadDebug is for diagnostics. Previous copies are backed up.
Removal preserves settings and refuses to delete plugins edited after installation.

Vesktop:
The launcher prepares a persistent build folder and shows its path. Choose it in
Vesktop Settings > Developer Settings > Vencord Location, restart. HandheldControls is enabled by default on first installation. Linux Flatpak may need access to the shown folder.

Builds and backup records are stored in your user's configuration folder under
DiscordHandheldControls. Once installed you can delete the extracted download;
download it again when you need to update or remove the plugins.

These launchers are unsigned. Windows SmartScreen or macOS security settings can
require an explicit open/allow action. Download only from this project's releases.
Linux Snap is not supported by the upstream injector. Windows/Linux injector
downloads target x64; macOS downloads cover Intel and Apple Silicon.

Preview: automated build/install checks pass, but controller behavior still needs
testing in logged-in Discord/BetterDiscord sessions on real hardware.

License: GPL-3.0-or-later, see LICENSE. Corresponding Vencord, native installer,
controller plugin, adapter and launcher sources are included under source/.
Full project and build instructions:
https://github.com/AhmxdNYC/discord-handheld-controls
