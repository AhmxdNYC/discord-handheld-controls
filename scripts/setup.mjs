#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "b52ed365cf2ea64a5019b419291a2d9d4d76852d";
const names = ["handheldControls.ts", "heldIndicator.ts", "gamepadDebug.ts"];
const args = process.argv.slice(2);
const help = `Usage: node scripts/setup.mjs [--vencord PATH] [--stage-only] [--inject]

Default: clone pinned Vencord into .build/Vencord, copy plugins, install dependencies,
type-check and build. No Discord installation is modified by the default command.
--vencord PATH  Use an existing Vencord checkout; differing plugins are never overwritten.
--stage-only    Only copy plugins to an existing checkout (no install/build).
--inject        After building, open Vencord's installer to select regular Discord.
--help          Show this help.

Keep the Vencord checkout after installation: Discord loads its build from there.
Enable HandheldControls in Discord Settings > Vencord > Plugins and restart Discord.`;

function run(cmd, argv, cwd) {
    const result = spawnSync(cmd, argv, { cwd, stdio: "inherit", shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${cmd} exited with status ${result.status}`);
}

try {
    let target = join(root, ".build", "Vencord");
    let explicit = false, stageOnly = false, inject = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--help") { console.log(help); process.exit(0); }
        else if (args[i] === "--vencord") {
            if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("--vencord requires a path");
            target = resolve(args[++i]); explicit = true;
        } else if (args[i] === "--stage-only") stageOnly = true;
        else if (args[i] === "--inject") inject = true;
        else throw new Error(`Unknown option: ${args[i]}`);
    }
    if (stageOnly && inject) throw new Error("--stage-only cannot be combined with --inject");
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
    if (process.platform === "win32") {
        throw new Error("On Windows, use --stage-only, then run pnpm install --frozen-lockfile, pnpm testTsc, pnpm build and pnpm inject inside the checkout. See README.md.");
    }
    run("pnpm", ["install", "--frozen-lockfile"], target);
    run("pnpm", ["testTsc"], target);
    run("pnpm", ["build"], target);
    console.log(`Build ready: ${join(target, "dist")}`);
    if (inject) run(process.execPath, ["scripts/runInstaller.mjs", "--", "--install"], target);
    else console.log("For regular Discord, rerun with --inject. For Vesktop, select this dist folder in Developer Settings.");
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
