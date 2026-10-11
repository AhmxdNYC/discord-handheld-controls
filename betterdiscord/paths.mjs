import { homedir } from "node:os";
import { join } from "node:path";
export function pluginDirectory(platform = process.platform, env = process.env, home = homedir()) {
    if (platform === "win32") {
        if (!env.APPDATA) throw new Error("APPDATA is unavailable; pass --plugins-dir from BetterDiscord's Open Plugins Folder button");
        return join(env.APPDATA, "BetterDiscord", "plugins");
    }
    if (platform === "darwin") return join(home, "Library", "Application Support", "BetterDiscord", "plugins");
    if (platform === "linux") return join(env.XDG_CONFIG_HOME || join(home, ".config"), "BetterDiscord", "plugins");
    throw new Error(`Unsupported BetterDiscord platform: ${platform}`);
}
