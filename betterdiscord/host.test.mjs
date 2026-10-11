import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import definePlugin, { definePluginSettings, OptionType, get, set, lazy } from "./host.mjs";
import { pluginDirectory } from "./paths.mjs";

test("BetterDiscord defaults, migrations and data use its persistent namespace", async t => {
    const values = new Map();
    globalThis.BdApi = { Webpack: {}, Data: { load: (name, key) => values.get(`${name}:${key}`), save: (name, key, value) => values.set(`${name}:${key}`, value) } };
    t.after(() => delete globalThis.BdApi);
    const definition = { enabled: { type: OptionType.BOOLEAN, default: false }, layout: { type: OptionType.SELECT, options: [{ value: "xbox" }, { value: "auto", default: true }] } };
    const settings = definePluginSettings(definition);
    assert.equal(settings.store.enabled, false);
    assert.equal(settings.store.layout, "auto");
    settings.store.enabled = true;
    assert.equal(definePluginSettings(definition).store.enabled, true);
    await set("calibration", { centre: 0.1 });
    assert.deepEqual(await get("calibration"), { centre: 0.1 });
    assert.ok(values.has("HandheldControls:settings"));
});
test("lazy Discord modules retry discovery and bind methods to their store", () => {
    let module;
    const proxy = lazy(() => module, "TestStore");
    assert.throws(() => proxy.getValue, /TestStore/);
    module = { value: 7, getValue() { return this.value; } };
    assert.equal(proxy.getValue(), 7);
});
test("BetterDiscord lifecycle is repeatable and rolls back partial startup", () => {
    let starts = 0, stops = 0;
    const Plugin = definePlugin({ name: "Test", start() { starts++; }, stop() { stops++; } });
    const plugin = new Plugin();
    plugin.start(); plugin.start(); plugin.stop(); plugin.stop(); plugin.start(); plugin.stop();
    assert.equal(starts, 2); assert.equal(stops, 2);
    const Broken = definePlugin({ name: "Broken", start() { throw new Error("startup failed"); }, stop() { stops++; } });
    assert.throws(() => new Broken().start(), /startup failed/);
    assert.equal(stops, 3);
});
test("plugin paths cover all supported operating systems and custom XDG", () => {
    assert.equal(pluginDirectory("win32", { APPDATA: "/appdata" }, "/home"), join("/appdata", "BetterDiscord", "plugins"));
    assert.equal(pluginDirectory("darwin", {}, "/home"), join("/home", "Library", "Application Support", "BetterDiscord", "plugins"));
    assert.equal(pluginDirectory("linux", { XDG_CONFIG_HOME: "/config" }, "/home"), join("/config", "BetterDiscord", "plugins"));
});
test("bundles load as standalone BetterDiscord plugin classes", () => {
    for (const name of ["HandheldControls", "HeldIndicator", "GamepadDebug"]) {
        const code = readFileSync(join("dist", "betterdiscord", `${name}.plugin.js`), "utf8");
        assert.ok(code.startsWith("/**\n * @name"));
        const context = vm.createContext({ module: { exports: {} }, window: {}, console, document: { createElement: () => ({ setAttribute() {} }) }, navigator: {}, setTimeout, clearTimeout, setInterval, clearInterval });
        vm.runInContext(code, context);
        const plugin = new context.module.exports();
        assert.equal(plugin.getName(), name);
        assert.equal(typeof plugin.start, "function");
        assert.equal(typeof plugin.stop, "function");
        assert.equal(typeof plugin.getSettingsPanel, "function");
    }
});
test("BetterDiscord install copies bundles and uninstall protects edited files", t => {
    const directory = mkdtempSync(join(tmpdir(), "BetterDiscord plugins "));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const run = (...args) => spawnSync(process.execPath, ["scripts/install-betterdiscord.mjs", "--plugins-dir", directory, ...args], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const file = join(directory, "HandheldControls.plugin.js");
    const original = readFileSync(file);
    writeFileSync(file, "edited");
    const result = run("--uninstall");
    assert.equal(result.status, 1); assert.match(result.stderr, /Refusing to remove edited/);
    assert.equal(readFileSync(file, "utf8"), "edited");
    assert.ok(existsSync(join(directory, "HeldIndicator.plugin.js")));
    writeFileSync(file, original);
    assert.equal(run("--uninstall").status, 0);
    assert.equal(existsSync(file), false);
});
