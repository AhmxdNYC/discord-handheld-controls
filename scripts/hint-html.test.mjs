import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../plugins/handheldControls.ts', import.meta.url), 'utf8');
const slice = source.slice(source.indexOf('// hint-html:'), source.indexOf('// end hint-html'));
const js = slice
    .replace(/\(items: \[string\[\], string\]\[\], dead: string\[\], badge: \(b: any\) => string\): string/, '(items, dead, badge)');
const hintsHtml = new Function(`${js}; return hintsHtml;`)();
const badge = b => `<i>${b}</i>`;

test('live hints are plain', () => {
    const html = hintsHtml([[['A'], 'open'], [['X'], 'options']], [], badge);
    assert.equal(html, '<span class="hh-hint"><i>A</i><span>open</span></span><span class="hh-hint"><i>X</i><span>options</span></span>');
});

test('a hint whose button does nothing here is greyed, the others stay', () => {
    const html = hintsHtml([[['A'], 'open'], [['X'], 'options'], [['Y'], 'areas']], ['X'], badge);
    assert.match(html, /<span class="hh-hint hh-hint-off"><i>X<\/i><span>options<\/span><\/span>/);
    assert.equal((html.match(/hh-hint-off/g) ?? []).length, 1);
});

test('a two-button hint is greyed only when both buttons are dead', () => {
    assert.doesNotMatch(hintsHtml([[['LB', 'RB'], 'servers']], ['LB'], badge), /hh-hint-off/);
    assert.match(hintsHtml([[['LB', 'RB'], 'servers']], ['LB', 'RB'], badge), /hh-hint-off/);
});
