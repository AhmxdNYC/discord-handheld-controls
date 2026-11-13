import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../plugins/handheldControls.ts', import.meta.url), 'utf8');
const slice = source.slice(source.indexOf('// stick-hysteresis:'), source.indexOf('// end stick-hysteresis'));
const js = slice
    .replace(/\(x: number, y: number, dz: number, prev: Dir \| null\): Dir \| null/, '(x, y, dz, prev)')
    .replace(/\(d: Dir\)/, '(d)')
    .replace(/\(\): Dir =>/, '() =>');
const dirFrom = new Function(`${js}; return stickDirFrom;`)();
const DZ = 0.5;

test('turns on only past the deadzone', () => {
    assert.equal(dirFrom(0.45, 0, DZ, null), null);
    assert.equal(dirFrom(0.55, 0, DZ, null), 'right');
    assert.equal(dirFrom(0, -0.7, DZ, null), 'up');
});

test('a stick wobbling around the deadzone stays one press (no double step)', () => {
    let d = null; const seen = [];
    for (const x of [0.55, 0.48, 0.52, 0.45, 0.51, 0.4]) { d = dirFrom(x, 0, DZ, d); seen.push(d); }
    assert.deepEqual(seen, Array(6).fill('right'));
});

test('turns off below 60 % of the deadzone', () => {
    assert.equal(dirFrom(0.31, 0, DZ, 'right'), 'right');
    assert.equal(dirFrom(0.29, 0, DZ, 'right'), null);
});

test('a diagonal wobble keeps the held direction; a clear turn switches', () => {
    assert.equal(dirFrom(0.6, 0.65, DZ, 'right'), 'right');
    assert.equal(dirFrom(0.3, 0.8, DZ, 'right'), 'down');
});

test('flicking to the opposite side switches at once', () => {
    assert.equal(dirFrom(-0.7, 0, DZ, 'right'), 'left');
});
