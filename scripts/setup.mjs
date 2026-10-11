#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findNpm, installerArguments, run } from "./runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "b52ed365cf2ea64a5019b419291a2d9d4d76852d";
const names = ["handheldControls.ts", "heldIndicator.ts", "gamepadDebug.ts"];
const args = process.argv.slice(2);
const help = `Usage: node scripts/setup.mjs [--vencord PATH] [--stage-only] [--inject|--uninstall] [--client discord|vencord|vesktop|betterdiscord] [--branch stable|ptb|canary|auto | --location PATH] [--plugins-dir PATH]

Default: clone pinned Vencord into .build/Vencord, copy plugins, install dependencies,
type-check and build. No Discord installation is modified by the default command.
--vencord PATH  Use an existing Vencord checkout; differing plugins are never overwritten.
--stage-only    Only copy plugins to an existing checkout (no install/build).
--inject        After building, open Vencord's installer to select regular Discord.
--uninstall     Restore Discord through the installer, without rebuilding.
--client NAME   discord/vencord: patch official Discord; vesktop: build and show configuration.
                betterdiscord: build .plugin.js files; --inject copies them to an existing BetterDiscord folder.
--plugins-dir   Custom BetterDiscord plugin folder (use Open Plugins Folder in its settings).
--branch NAME   Select a Discord channel without the interactive installation picker.
--location PATH Select a custom Discord installation (instead of --branch).
--help          Show this help.

Keep the Vencord checkout after installation: Discord loads its build from there.
Enable HandheldControls in Discord Settings > Vencord > Plugins and restart Discord.`;

try {
    let target = join(root, ".build", "Vencord");
    let explicit = false, stageOnly = false, inject = false, uninstall = false;
    let client = "discord", branch, location, pluginsDir;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--help") { console.log(help); process.exit(0); }
        else if (args[i] === "--vencord") {
            if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("--vencord requires a path");
            target = resolve(args[++i]); explicit = true;
        } else if (args[i] === "--stage-only") stageOnly = true;
        else if (args[i] === "--inject") inject = true;
        else if (args[i] === "--uninstall") uninstall = true;
        else if (["--client", "--branch", "--location", "--plugins-dir"].includes(args[i])) {
            const flag = args[i], value = args[++i];
            if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
            if (flag === "--client") client = value;
            if (flag === "--branch") branch = value;
            if (flag === "--location") location = resolve(value);
            if (flag === "--plugins-dir") pluginsDir = resolve(value);
        }
        else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (stageOnly && inject) throw new Error("--stage-only cannot be combined with --inject");
    if (stageOnly && uninstall || inject && uninstall) throw new Error("Choose one of --stage-only, --inject or --uninstall");
    if (!["discord", "vencord", "vesktop", "betterdiscord"].includes(client)) throw new Error("--client must be discord, vencord, vesktop or betterdiscord");
    if (pluginsDir && client !== "betterdiscord") throw new Error("--plugins-dir applies only to BetterDiscord");
    if (client === "betterdiscord") {
        if (branch || location || explicit || stageOnly) throw new Error("BetterDiscord uses --plugins-dir; Vencord and Discord selectors do not apply");
        const bdArgs = pluginsDir ? ["--plugins-dir", pluginsDir] : [];
        if (uninstall) run(process.execPath, [join(root, "scripts", "install-betterdiscord.mjs"), "--uninstall", ...bdArgs], root);
        else {
            const esbuild = join(root, "node_modules", "esbuild", "package.json");
            if (!existsSync(esbuild)) run(process.execPath, [findNpm(), "ci", "--ignore-scripts", "--no-audit", "--no-fund"], root);
            run(process.execPath, [join(root, "scripts", "build-betterdiscord.mjs")], root);
            if (inject) run(process.execPath, [join(root, "scripts", "install-betterdiscord.mjs"), ...bdArgs], root);
            else console.log(`BetterDiscord plugins ready: ${join(root, "dist", "betterdiscord")}`);
        }
        process.exit(0);
    }
    if (client === "vesktop" && (inject || uninstall || branch || location)) throw new Error("Vesktop loads the dist folder; injection and Discord selectors apply to discord/vencord only");
    installerArguments(uninstall ? "uninstall" : "install", branch, location);
    const installArgs = ["--vencord", target, ...(branch ? ["--branch", branch] : []), ...(location ? ["--location", location] : [])];
    if (uninstall) {
        run(process.execPath, [join(root, "scripts", "inject.mjs"), "--uninstall", ...installArgs], root);
        process.exit(0);
    }
    if (!existsSync(target)) {
        if (explicit || stageOnly) throw new Error(`Vencord checkout does not exist: ${target}`);
        mkdirSync(dirname(target), { recursive: true });
        run("git", ["clone", "https://github.com/Vendicated/Vencord.git", target], root);
        run("git", ["checkout", "--detach", revision], target);
    }
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    if (pkg.name !== "vencord" || !existsSync(join(target, "src")) || !existsSync(join(target, "scripts", "runInstaller.mjs"))) {
        throw new Error("Target must be a Vencord source checkout");
    }
    const destination = join(target, "src", "userplugins");
    // Preflight every file so a conflict does not leave a partial copy.
    for (const name of names) {
        const dest = join(destination, name);
        if (existsSync(dest) && !readFileSync(dest).equals(readFileSync(join(root, "plugins", name)))) {
            throw new Error(`Refusing to overwrite different plugin: ${dest}. Back it up or use a fresh checkout.`);
        }
    }
    mkdirSync(destination, { recursive: true });
    for (const name of names) writeFileSync(join(destination, name), readFileSync(join(root, "plugins", name)));
    console.log(`Plugins staged in ${destination}`);
    if (stageOnly) process.exit(0);
    const version = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager)?.[1];
    if (!version) throw new Error("Vencord must declare an exact pnpm version");
    const tools = join(root, ".build", "tools", version);
    const pnpm = join(tools, "node_modules", "pnpm", "bin", "pnpm.cjs");
    if (!existsSync(pnpm)) {
        run(process.execPath, [findNpm(), "install", "--prefix", tools, "--ignore-scripts", "--no-audit", "--no-fund", `pnpm@${version}`], root);
    }
    run(process.execPath, [pnpm, "install", "--frozen-lockfile"], target);
    run(process.execPath, [pnpm, "testTsc"], target);
    run(process.execPath, [pnpm, "build"], target);
    console.log(`Build ready: ${join(target, "dist")}`);
    if (inject) run(process.execPath, [join(root, "scripts", "inject.mjs"), "--install", ...installArgs], root);
    else console.log("For Discord/Vencord, run node scripts/inject.mjs. For Vesktop, select this dist folder in Developer Settings.");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
