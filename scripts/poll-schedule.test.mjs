import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../plugins/handheldControls.ts', import.meta.url), 'utf8');
const slice = source.slice(source.indexOf('// poll-schedule:'), source.indexOf('// end poll-schedule'));

function asJs(ts) {
    return ts
        .replace(/ as any/g, '')
        .replace(/:\s*boolean/g, '')
        .replace(/:\s*number\s*\|\s*null/g, '')
        .replace(/:\s*number\b/g, '')
        .replace(/:\s*Gamepad/g, '')
        .replace(/:\s*string/g, '');
}

function pad(pressedIndex = -1, axes = [0, 0, 0, 0]) {
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === pressedIndex, value: i === pressedIndex ? 1 : 0 }));
    return { buttons, axes, mapping: 'standard', id: 'test' };
}

function load() {
    let now = 0;
    const rafs = [];
    const timers = [];
    const document = { hidden: false };
    const window = {};
    const navigator = { getGamepads: () => [] };
    const performance = { now: () => now };
    const settings = { store: { stickDeadzone: 0.2 } };
    const requestAnimationFrame = (fn) => { rafs.push(fn); return rafs.length; };
    const cancelAnimationFrame = (id) => { rafs[id - 1] = null; };
    const setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length; };
    const clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const g = new Function('document', 'window', 'navigator', 'performance', 'settings', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', `
        let raf = 0, pollTimer = 0, loopOn = true, lastPadSignature = "", lastPadChangeAt = 0;
        let extPad = null, extAliveAt = 0;
        let pad = null;
        let handledAt = null;
        function getPad() { return pad; }
        function tick() {
            raf = 0;
            pollTimer = 0;
            handledAt = performance.now();
            notePadActivity();
            armNextTick();
        }
        ${asJs(slice)}
        return {
            nextPollDelay, notePadActivity, armNextTick, wakeLoop, pokePoll, onVisibility, clearLoopTimers,
            setPad(p) { pad = p; },
            setExt(p, alive) { extPad = p; extAliveAt = alive; },
            setLoop(v) { loopOn = v; },
            rafId: () => raf,
            pollId: () => pollTimer,
            lastChange: () => lastPadChangeAt,
            handledAt: () => handledAt,
        };
    `)(document, window, navigator, performance, settings, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout);
    return { ...g, document, navigator, rafs, timers, setNow(t) { now = t; } };
}

test('hidden or no pad waits 250 ms, a quiet pad waits 100 ms, a fresh change stays on frames', () => {
    const g = load();
    assert.equal(g.nextPollDelay(true, true, 0), 250);
    assert.equal(g.nextPollDelay(false, false, 0), 250);
    assert.equal(g.nextPollDelay(false, true, 4999), null);
    assert.equal(g.nextPollDelay(false, true, 5000), 100);
    assert.equal(g.nextPollDelay(true, true, 5000), 250);
});

test('after 5 s still, the next poll is 100 ms, and the press that ends the wait returns to frames', () => {
    const g = load();
    const still = pad();
    g.navigator.getGamepads = () => [still];
    g.setPad(still);
    g.setNow(1000);
    assert.equal(g.notePadActivity(), true);
    g.armNextTick();
    assert.equal(g.rafId() > 0, true);
    assert.equal(g.timers.length, 0);

    g.setNow(1000 + 5000);
    g.clearLoopTimers();
    g.armNextTick();
    assert.equal(g.rafId(), 0);
    assert.equal(g.timers.at(-1).delay, 100);
    assert.equal(g.timers.at(-1).fn.name, 'tick');

    g.setPad(pad(0));
    g.setNow(6000 + 100);
    assert.equal(g.notePadActivity(), true);
    g.clearLoopTimers();
    g.armNextTick();
    assert.ok(g.rafId() > 0);
    assert.equal(g.timers.at(-1).fn, null);
});

test('a hidden window or a newly connected pad wakes on one immediate poll, not a frame loop', () => {
    const hidden = load();
    hidden.document.hidden = true;
    hidden.navigator.getGamepads = () => [pad()];
    hidden.setNow(50);
    hidden.wakeLoop();
    assert.equal(hidden.rafId(), 0);
    assert.equal(hidden.timers.at(-1).delay, 0);
    assert.equal(hidden.timers.at(-1).fn.name, 'tick');

    const none = load();
    none.setNow(50);
    none.wakeLoop();
    assert.equal(none.rafs.length, 0);
    assert.equal(none.timers.at(-1).delay, 0);

    const shown = load();
    shown.navigator.getGamepads = () => [pad()];
    shown.setNow(50);
    shown.wakeLoop();
    assert.ok(shown.rafId() > 0);
    assert.equal(shown.timers.length, 0);
});

test('the running tick handles the pad before it chooses the next wait, and stop can halt it', () => {
    const tickAt = source.indexOf('function tick() {');
    const tick = source.slice(tickAt, source.indexOf('function tickInner(', tickAt));
    const innerAt = tick.indexOf('tickInner()');
    const noteAt = tick.indexOf('notePadActivity()');
    const armAt = tick.indexOf('armNextTick()');
    assert.ok(innerAt > 0 && noteAt > innerAt && armAt > noteAt);
    assert.equal(tick.slice(0, innerAt).includes('requestAnimationFrame(tick)'), false);
    assert.match(source, /loopOn = true;/);
    assert.match(source, /document\.addEventListener\("visibilitychange", onVisibility\)/);
    assert.match(source, /loopOn = false;\s*clearLoopTimers\(\)/);
    assert.match(source, /document\.removeEventListener\("visibilitychange", onVisibility\)/);
    assert.match(source, /const onPadConnected = \(e: GamepadEvent\) => \{ showPadCard\(e\.gamepad, true\); wakeLoop\(\); \}/);
    const stopped = load();
    stopped.setLoop(false);
    stopped.navigator.getGamepads = () => [pad()];
    stopped.armNextTick();
    stopped.wakeLoop();
    assert.equal(stopped.rafs.length, 0);
    assert.equal(stopped.timers.length, 0);
});

test('a live bridge pad stays on frames, and a stale one falls back to the 250 ms poll', () => {
    const live = load();
    live.setNow(5000);
    live.setExt(pad(), 4000);
    live.setPad(pad());
    assert.equal(live.notePadActivity(), true);
    live.armNextTick();
    assert.ok(live.rafId() > 0);
    assert.equal(live.timers.length, 0);

    const stale = load();
    stale.setNow(5000);
    stale.setExt(pad(), 1000);
    stale.armNextTick();
    assert.equal(stale.rafId(), 0);
    assert.equal(stale.timers.at(-1).delay, 250);
});

test('the first press after a quiet pad is handled on that same poll, within 100 ms', () => {
    const g = load();
    g.navigator.getGamepads = () => [pad()];
    g.setPad(pad());
    g.setNow(1000);
    assert.equal(g.notePadActivity(), true);
    g.setNow(6000);
    g.clearLoopTimers();
    g.armNextTick();
    assert.equal(g.timers.at(-1).delay, 100);
    const pressAt = 6050;
    g.setPad(pad(0));
    g.setNow(6100);
    g.timers.at(-1).fn();
    assert.equal(g.handledAt(), 6100);
    assert.ok(6100 - pressAt <= 100);
    assert.ok(g.rafId() > 0);
});

test('a pad change during the slow wait is pulled forward to an immediate poll', () => {
    const g = load();
    g.navigator.getGamepads = () => [pad()];
    g.setPad(pad());
    g.setNow(1000);
    g.notePadActivity();
    g.setNow(7000);
    g.clearLoopTimers();
    g.armNextTick();
    assert.equal(g.timers.at(-1).delay, 100);
    g.pokePoll();
    assert.equal(g.rafId(), 0);
    assert.equal(g.timers.at(-1).delay, 0);
    g.setPad(pad(1));
    g.setNow(7010);
    g.timers.at(-1).fn();
    assert.equal(g.handledAt(), 7010);
    assert.ok(7010 - 7000 <= 100);
    assert.ok(g.rafId() > 0);
});
