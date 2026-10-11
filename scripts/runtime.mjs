import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export function run(command, args, cwd, env = process.env) {
    const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
}

// Execute npm's JS entry point with Node so Windows .cmd shims and shell quoting are unnecessary.
export function findNpm(env = process.env, executable = process.execPath) {
    const directories = [dirname(executable), ...(env.PATH ?? env.Path ?? "").split(delimiter)];
    for (const directory of directories) {
        if (!directory) continue;
        for (const path of [join(directory, "node_modules", "npm", "bin", "npm-cli.js"), join(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]) {
            if (existsSync(path)) return realpathSync(path);
        }
        const bin = join(directory, "npm");
        if (existsSync(bin)) {
            const path = realpathSync(bin);
            if (path.endsWith("npm-cli.js")) return path;
        }
    }
    throw new Error("npm was not found. Install Node.js with npm, then retry.");
}

export function installerAsset(platform = process.platform, arch = process.arch) {
    if (!(["x64", "arm64"].includes(arch))) throw new Error(`Unsupported CPU architecture: ${arch}`);
    if (platform === "darwin") return "VencordInstallerCli-darwin"; // upstream universal binary
    if (arch !== "x64") throw new Error(`Upstream installer has no native ${platform}/${arch} release. Use an x64 Node/runtime or install Vencord manually.`);
    if (platform === "linux") return "VencordInstallerCli-linux";
    if (platform === "win32") return "VencordInstallerCli.exe";
    throw new Error(`Unsupported operating system: ${platform}`);
}

export function installerArguments(action, branch, location) {
    if (!["install", "uninstall"].includes(action)) throw new Error("Invalid installer action");
    if (branch && location) throw new Error("--branch and --location cannot be combined");
    if (branch && !["auto", "stable", "ptb", "canary"].includes(branch)) throw new Error("--branch must be auto, stable, ptb or canary");
    return [`--${action}`, ...(branch ? ["--branch", branch] : []), ...(location ? ["--location", location] : [])];
}
