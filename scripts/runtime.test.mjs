import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findNpm, installerArguments, installerAsset, run } from "./runtime.mjs";

test("native installer selection covers Windows, Linux and both macOS architectures", () => {
    assert.equal(installerAsset("win32", "x64"), "VencordInstallerCli.exe");
    assert.equal(installerAsset("linux", "x64"), "VencordInstallerCli-linux");
    for (const arch of ["x64", "arm64"]) assert.equal(installerAsset("darwin", arch), "VencordInstallerCli-darwin");
    assert.throws(() => installerAsset("linux", "arm64"), /no native/);
    assert.throws(() => installerAsset("freebsd", "x64"), /Unsupported operating/);
});
test("custom paths are preserved as a single argument and uninstall uses restore action", () => {
    assert.deepEqual(installerArguments("install", undefined, "C:\\Users\\Test Person\\Discord"), ["--install", "--location", "C:\\Users\\Test Person\\Discord"]);
    assert.deepEqual(installerArguments("uninstall", "canary"), ["--uninstall", "--branch", "canary"]);
    assert.throws(() => installerArguments("install", "stable", "/opt/discord"), /cannot be combined/);
    assert.throws(() => installerArguments("install", "unknown"), /--branch/);
});
test("npm can be found next to Node without running a Windows command shim", t => {
    const dir = mkdtempSync(join(tmpdir(), "node installation "));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const npm = join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(join(dir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(npm, "");
    assert.equal(findNpm({ PATH: "" }, join(dir, "node.exe")), realpathSync(npm));
});
test("subprocess failures are propagated", () => {
    assert.throws(() => run(process.execPath, ["-e", "process.exit(7)"], process.cwd()), /failed \(7\)/);
});
