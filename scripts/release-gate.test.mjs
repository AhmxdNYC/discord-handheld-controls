import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../plugins/handheldControls.ts', import.meta.url), 'utf8');
const slice = source.slice(source.indexOf('// release-gate:'), source.indexOf('// end release-gate'));

function asJs(ts) {
    return ts
        .replace(/:\s*boolean\[\]/g, '')
        .replace(/:\s*ArrayLike<number>/g, '')
        .replace(/:\s*number\b/g, '')
        .replace(/:\s*boolean\b/g, '');
}

function load() {
    return new Function(`
        let heldDir = 'down';
        const holdState = new Map([[4, { since: 1, last: 1 }]]);
        ${asJs(slice)}
        return {
            arm: () => armReleaseGate(),
            wait: (pressed, axes, deadzone) => padWaitingForRelease(pressed, axes, deadzone),
            dir: () => heldDir,
            holds: () => holdState.size,
            armed: () => releaseGate,
        };
    `)();
}

const up = [false, false, false, false];
const heldA = [true, false, false, false];
const center = [0, 0, 0, 0];

test('a close waits while any button or stick is still held', () => {
    const g = load();
    assert.equal(g.wait(heldA, center, 0.2), false);
    g.arm();
    assert.equal(g.dir(), null);
    assert.equal(g.holds(), 0);
    assert.equal(g.wait(heldA, center, 0.2), true);
    assert.equal(g.armed(), true);
    assert.equal(g.wait(up, [0, 0.9, 0, 0], 0.2), true);
    assert.equal(g.wait(up, [0, 0.1, 0, 0], 0.2), false);
    assert.equal(g.armed(), false);
});

test('once the pad is neutral, later holds are normal presses', () => {
    const g = load();
    g.arm();
    assert.equal(g.wait(up, center, 0.2), false);
    assert.equal(g.wait(heldA, center, 0.2), false);
});

test('every close path arms the same gate, and the tick checks it before Discord', () => {
    const body = (name) => {
        const at = source.indexOf(`function ${name}(`);
        assert.ok(at > 0, name);
        return source.slice(at, source.indexOf('\nfunction ', at + 1));
    };
    for (const name of ['closeKeyboard', 'closeCalibration', 'closeDrawer', 'closeSubmenu', 'stopTyping', 'toggleHelp', 'togglePanel'])
        assert.match(body(name), /armReleaseGate\(\)/, name);
    const escapeAt = source.indexOf('const escape = () => {');
    assert.match(source.slice(escapeAt, escapeAt + 180), /armReleaseGate\(\)/);
    const menuAt = source.indexOf('if (!menu) {');
    assert.match(source.slice(menuAt, menuAt + 220), /armReleaseGate\(\)/);
    const tick = body('tickInner');
    const gateAt = tick.indexOf('padWaitingForRelease(');
    const actAt = tick.indexOf('if (justPressed(Btn.A)) pressA()');
    assert.ok(gateAt > 0 && actAt > gateAt);
    assert.match(tick, /lastExpressionOpen && !expression\) armReleaseGate\(\)/);
    assert.match(body('usePointerKeyboard'), /closeCalibration\(\)/);
});
