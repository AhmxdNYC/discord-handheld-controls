import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
    const target = mkdtempSync(join(tmpdir(), "handheld test "));
    t.after(() => rmSync(target, { recursive: true, force: true }));
    mkdirSync(join(target, "src", "userplugins"), { recursive: true });
    mkdirSync(join(target, "scripts"));
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "vencord" }));
    writeFileSync(join(target, "scripts", "runInstaller.mjs"), "");
    return target;
}
const setup = (target, ...extra) => spawnSync(process.execPath, ["scripts/setup.mjs", "--vencord", target, "--stage-only", ...extra], { encoding: "utf8" });

test("staging works with spaces and is repeatable", t => {
    const target = fixture(t);
    assert.equal(setup(target).status, 0);
    assert.equal(setup(target).status, 0);
    for (const name of ["handheldControls.ts", "heldIndicator.ts", "gamepadDebug.ts"]) {
        assert.deepEqual(readFileSync(join(target, "src", "userplugins", name)), readFileSync(join("plugins", name)));
    }
});
test("conflict preflight preserves edits and avoids partial staging", t => {
    const target = fixture(t);
    const file = join(target, "src", "userplugins", "heldIndicator.ts");
    writeFileSync(file, "local edits");
    const result = setup(target);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to overwrite/);
    assert.equal(readFileSync(file, "utf8"), "local edits");
    assert.equal(existsSync(join(target, "src", "userplugins", "handheldControls.ts")), false);
});
test("stage-only cannot trigger injection", t => {
    const target = fixture(t);
    const result = setup(target, "--inject");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be combined/);
    assert.equal(existsSync(join(target, "src", "userplugins", "handheldControls.ts")), false);
});
test("Vesktop rejects Discord patch options before touching source", t => {
    const target = fixture(t);
    const result = setup(target, "--client", "vesktop", "--branch", "stable");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Vesktop loads the dist folder/);
    assert.equal(existsSync(join(target, "src", "userplugins", "handheldControls.ts")), false);
});
test("invalid Discord selectors fail before staging", t => {
    const target = fixture(t);
    assert.equal(setup(target, "--branch", "bogus").status, 1);
    assert.equal(setup(target, "--branch", "stable", "--location", target).status, 1);
    assert.equal(setup(target, "--uninstall").status, 1);
});
