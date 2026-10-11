import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginDirectory } from "../betterdiscord/paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = ["HandheldControls.plugin.js", "HeldIndicator.plugin.js", "GamepadDebug.plugin.js"];
const hash = value => createHash("sha256").update(value).digest("hex");
try {
    let destination, uninstall = false;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--uninstall") uninstall = true;
        else if (args[i] === "--plugins-dir") {
            if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("--plugins-dir requires a path");
            destination = resolve(args[++i]);
        } else throw new Error(`Unknown option: ${args[i]}`);
    }
    destination ??= pluginDirectory();
    if (!existsSync(destination) || !statSync(destination).isDirectory()) throw new Error(`BetterDiscord plugin folder does not exist: ${destination}. Install BetterDiscord first, or pass --plugins-dir from Open Plugins Folder.`);
    const manifests = join(root, ".build", "betterdiscord-installs");
    const manifest = join(manifests, `${hash(destination)}.json`);
    if (uninstall) {
        if (!existsSync(manifest)) throw new Error("No installation record for this folder; disable/remove these plugins through BetterDiscord instead");
        const record = JSON.parse(readFileSync(manifest, "utf8"));
        for (const name of names) {
            const file = join(destination, name);
            if (existsSync(file) && hash(readFileSync(file)) !== record.hashes[name]) throw new Error(`Refusing to remove edited plugin: ${file}`);
        }
        for (const name of names) { const file = join(destination, name); if (existsSync(file)) unlinkSync(file); }
        unlinkSync(manifest);
        console.log("Removed controller plugins. BetterDiscord and saved settings remain installed.");
    } else {
        const sources = names.map(name => readFileSync(join(root, "dist", "betterdiscord", name)));
        const backup = join(root, ".build", "betterdiscord-backups", `${Date.now()}-${hash(destination).slice(0, 8)}`);
        for (const [index, name] of names.entries()) {
            const file = join(destination, name);
            if (existsSync(file) && !readFileSync(file).equals(sources[index])) {
                mkdirSync(backup, { recursive: true });
                writeFileSync(join(backup, name), readFileSync(file));
            }
        }
        const hashes = {};
        for (const [index, name] of names.entries()) {
            writeFileSync(join(destination, name), sources[index]); hashes[name] = hash(sources[index]);
        }
        mkdirSync(manifests, { recursive: true });
        writeFileSync(manifest, JSON.stringify({ destination, hashes }, null, 2));
        console.log(`Installed controller plugins in ${destination}. Enable HandheldControls in BetterDiscord Settings → Plugins.`);
        if (existsSync(backup)) console.log(`Previous plugin copies backed up in ${backup}`);
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }
