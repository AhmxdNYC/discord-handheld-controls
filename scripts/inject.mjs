#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installerArguments, installerAsset, run } from "./runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = "v1.4.2";
const digests = {
    "VencordInstallerCli-darwin": "f4c77a9dddd4a12deaae270b3dadfda25969dfcfa141cc2354cafe6344044b75",
    "VencordInstallerCli-linux": "52642c8521a866ad241c10337144a4f513672c54b9c86a8169954785054c815d",
    "VencordInstallerCli.exe": "15268aba25625797bf562187dd87ddadf42882e079c7b6192880ad3e83353ef5"
};
const hash = data => createHash("sha256").update(data).digest("hex");

try {
    const args = process.argv.slice(2);
    let target = join(root, ".build", "Vencord"), action = "install", branch, location;
    let actionSet = false, downloadOnly = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--help") {
            console.log("Usage: node scripts/inject.mjs [--install|--uninstall] [--vencord PATH] [--branch stable|ptb|canary|auto | --location PATH] [--download-only]\nWithout branch/location, select the Discord installation interactively. --download-only verifies the installer without patching Discord.");
            process.exit(0);
        } else if (["--install", "--uninstall"].includes(args[i])) {
            if (actionSet) throw new Error("Choose only one installer action");
            action = args[i].slice(2); actionSet = true;
        } else if (args[i] === "--download-only") downloadOnly = true;
        else if (["--vencord", "--branch", "--location"].includes(args[i])) {
            const flag = args[i], value = args[++i];
            if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
            if (flag === "--vencord") target = resolve(value);
            if (flag === "--branch") branch = value;
            if (flag === "--location") location = resolve(value);
        } else throw new Error(`Unknown option: ${args[i]}`);
    }
    const installerArgs = installerArguments(action, branch, location);
    const name = installerAsset();
    if (action === "install" && !downloadOnly) {
        for (const file of ["patcher.js", "preload.js", "renderer.js"]) {
            if (!existsSync(join(target, "dist", file))) throw new Error(`Missing build ${file}. Run node scripts/setup.mjs first, or download the release bundle.`);
        }
    }
    const cache = join(root, ".build", "installers", tag);
    const binary = join(cache, name);
    if (!existsSync(binary) || hash(readFileSync(binary)) !== digests[name]) {
        console.log(`Downloading Vencord installer ${tag} for ${process.platform}/${process.arch}…`);
        const response = await fetch(`https://github.com/Vencord/Installer/releases/download/${tag}/${name}`, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Installer download failed: HTTP ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (hash(data) !== digests[name]) throw new Error("Installer SHA-256 verification failed");
        mkdirSync(cache, { recursive: true });
        writeFileSync(`${binary}.tmp`, data, { mode: 0o755 });
        renameSync(`${binary}.tmp`, binary);
    }
    if (process.platform !== "win32") chmodSync(binary, 0o755);
    if (downloadOnly) console.log(`Verified installer: ${binary}`);
    else {
        console.log(`Using controller build: ${target}\nFully quit Discord before continuing.`);
        run(binary, installerArgs, root, { ...process.env, VENCORD_USER_DATA_DIR: target, VENCORD_DEV_INSTALL: "1" });
        console.log(action === "install" ? "Installer finished. Restart Discord. HandheldControls is enabled by default on first installation." : "Installer finished. Restart Discord.");
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
