import test from 'node:test';
import assert from 'node:assert/strict';
import { colour, length, firstFamily, normaliseRecord, tokenTable, tokenFor, TOKEN_FAMILIES, LAYOUT_VERSION, MAX_COLOUR_TEXT } from '../../src/layout/record.js';
import { compareLayout, compareRecords, sameValue, sameToken, differenceMessage } from '../../src/layout/compare.js';
import { normalizeLayoutParts, normalizeLayoutConfig } from '../../src/layout/declaration.js';
import { validateLayoutSnapshot } from '../../src/layout/snapshot.js';
import { layoutSnapshot } from '../../src/layout/extract.js';

const raw = (changes = {}) => ({
  rect: { width: 320.25, height: 48 }, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'space-between', alignItems: 'center',
  rowGap: 'normal', columnGap: '16px', paddingTop: '8px', paddingRight: '12px', paddingBottom: '8px', paddingLeft: '12px',
  fontFamily: '"Example Sans", Arial, sans-serif', fontSize: '20px', fontWeight: '600', lineHeight: '28px', letterSpacing: 'normal',
  color: 'oklch(0 0 0)', backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '0px', borderTopColor: 'rgb(1, 2, 3)', borderTopLeftRadius: '8px', ...changes,
});
const table = tokenTable([
  { name: '--spacing-4', length: '16px', colour: null },
  { name: '--text-xl', length: '20px', colour: null },
  { name: '--radius-md', length: '8px', colour: null },
  { name: '--size-20', length: '20px', colour: null },
  { name: '--color-ink', length: null, colour: 'oklab(0 0 0)' },
  { name: '--color-white', length: null, colour: 'rgb(255 255 255)' },
  { name: 'not-a-property', length: '1px', colour: null },
]);

test('colour normalisation reads hex, rgb, rgba, space syntax, oklab and oklch', () => {
  assert.equal(colour('#FFF'), '#ffffff');
  assert.equal(colour('#ff000080'), '#ff000080');
  assert.equal(colour('#ff0000ff'), '#ff0000');
  assert.equal(colour('rgb(255, 0, 0)'), '#ff0000');
  assert.equal(colour('rgba(0, 0, 255, 0.5)'), '#0000ff80');
  assert.equal(colour('rgb(0 128 0 / 50%)'), '#00800080');
  assert.equal(colour('rgba(0, 0, 0, 0)'), '#00000000');
  assert.equal(colour('transparent'), '#00000000');
  // OKLab anchors: white, black and sRGB red.
  assert.equal(colour('oklch(1 0 0)'), '#ffffff');
  assert.equal(colour('oklch(0 0 0)'), '#000000');
  assert.equal(colour('oklab(0.627955 0.224863 0.125846)'), '#ff0000');
  assert.equal(colour('oklab(62.7955% 0.224863 0.125846)'), '#ff0000');
  // The same red in polar form: chroma sqrt(a² + b²), hue atan2(b, a).
  assert.equal(colour('oklch(0.627955 0.257683 29.2339)'), '#ff0000');
  assert.equal(colour('oklch(1 0 0 / 0.5)'), '#ffffff80');
  assert.equal(colour('oklch(1 0 none)'), '#ffffff');
  for (const value of ['', '   ', 'a\u0000b', null, 7]) assert.equal(colour(value), null, String(value));
});

test('every colour path gives one normal form: an alpha byte of ff is dropped (R6.14)', () => {
  const red = ['#f00', '#f00f', '#FF0000', '#ff0000ff', 'rgb(255, 0, 0)', 'rgba(255, 0, 0, 1)', 'rgba(255, 0, 0, 0.999)', 'rgb(255 0 0 / 1)',
    'rgb(255 0 0 / 0.999)', 'rgb(255 0 0 / 100%)', 'rgb(255 0 0 / 99.9%)', 'rgb(100% 0% 0%)', 'oklab(0.627955 0.224863 0.125846 / 1)',
    'oklab(0.627955 0.224863 0.125846 / 0.999)', 'oklch(0.627955 0.257683 29.2339 / 100%)', 'oklch(0.627955 0.257683 29.2339 / 0.999)'];
  for (const value of red) assert.equal(colour(value), '#ff0000', value);
  const half = ['#ff000080', '#f008', 'rgba(255, 0, 0, 0.5)', 'rgb(255 0 0 / 50%)', 'oklab(0.627955 0.224863 0.125846 / 0.5)', 'oklch(0.627955 0.257683 29.2339 / 50%)'];
  for (const value of half) assert.match(colour(value), /^#ff0000(80|88)$/, value);
  assert.equal(colour('#f008'), '#ff000088');
  assert.equal(colour('rgb(255 0 0 / 0.998)'), '#ff0000fe', 'An alpha below the last byte keeps its byte.');
  // The normal form is stable: the reader gives a normal colour back unchanged.
  for (const value of [...red, ...half, 'transparent']) assert.equal(colour(colour(value)), colour(value), value);
});

test('a colour that the reader does not convert keeps its bounded lowercase text, so a change still shows (R6.14, R6.15)', () => {
  assert.equal(colour('  Color(Display-P3 1 0 0)  '), 'color(display-p3 1 0 0)');
  assert.equal(colour('color(srgb 1 0 0)'), 'color(srgb 1 0 0)');
  for (const value of ['red', 'rgb(1, 2)', 'oklch(a b c)', '#12345']) assert.equal(colour(value), value);
  assert.equal(colour('color(srgb ' + '1 '.repeat(300) + ')').length, MAX_COLOUR_TEXT);
  const p3 = normaliseRecord(raw({ color: 'color(display-p3 1 0 0)' }), table);
  const srgb = normaliseRecord(raw({ color: 'color(srgb 1 0 0)' }), table);
  assert.deepEqual(compareRecords('card', p3, srgb), [{ part: 'card', property: 'paint.color', kind: 'differs', a: 'color(display-p3 1 0 0)', b: 'color(srgb 1 0 0)' }]);
  assert.deepEqual(compareRecords('card', p3, structuredClone(p3)), []);
  // The stored file keeps the text, and the reader accepts it.
  assert.equal(validateLayoutSnapshot(snapshot([part('card', [p3])])).parts[0].records[0].paint.color, 'color(display-p3 1 0 0)');
});

test('lengths, families and line-height ratios normalise to CSS px', () => {
  assert.equal(length('16px'), 16);
  assert.equal(length('0.333333px'), 0.333);
  assert.equal(length('normal'), null);
  assert.equal(length('normal', { normal: 0 }), 0);
  assert.equal(length('50%'), null);
  assert.equal(length('auto'), null);
  assert.equal(firstFamily('"Example Sans", Arial'), 'Example Sans');
  assert.equal(firstFamily("'Mono', monospace"), 'Mono');
  const record = normaliseRecord(raw(), table);
  assert.deepEqual(record, {
    box: { width: 320.25, height: 48 },
    layout: { display: 'flex', direction: 'row', wrap: 'nowrap', justify: 'space-between', align: 'center', gap: 16, padding: [8, 12, 8, 12] },
    type: { family: 'Example Sans', size: 20, weight: 600, lineHeight: 1.4, letterSpacing: 0 },
    paint: { color: '#000000', background: '#ffffff', borderWidth: 0, borderColor: null, radius: 8 },
    tokens: { 'layout.gap': '--spacing-4', 'type.size': '--text-xl', 'paint.radius': '--radius-md', 'paint.color': '--color-ink', 'paint.background': '--color-white' },
  });
  // A block box has no flex or grid keys. A column flex box reads row-gap. A border colour needs a border.
  const block = normaliseRecord(raw({ display: 'block' }), table);
  assert.deepEqual([block.layout.direction, block.layout.wrap, block.layout.justify, block.layout.align, block.layout.gap], [null, null, null, null, null]);
  assert.equal(normaliseRecord(raw({ flexDirection: 'column', rowGap: '24px' })).layout.gap, 24);
  assert.equal(normaliseRecord(raw({ display: 'grid', columnGap: '32px' })).layout.gap, 32);
  assert.equal(normaliseRecord(raw({ borderTopWidth: '2px' })).paint.borderColor, '#010203');
  assert.equal(normaliseRecord(raw({ lineHeight: 'normal' })).type.lineHeight, null);
});

test('a token counts only when its value equals the record value and its name fits the property family', () => {
  // --size-20 also computes to 20px, but its name is no font-size name, so the font size takes --text-xl.
  assert.equal(tokenFor('type.size', 20, table), '--text-xl');
  // 20px is no spacing step here: --text-xl and --size-20 have the value, and neither name fits the gap family.
  assert.equal(tokenFor('layout.gap', 20, table), null);
  assert.equal(tokenFor('layout.gap', 16, table), '--spacing-4');
  // A length token never names a colour, and a colour token never names a length.
  assert.equal(tokenFor('paint.color', '#ffffff', table), '--color-white');
  assert.equal(tokenFor('paint.radius', 16, table), null);
  assert.equal(tokenFor('box.width', 320, table), null);
  assert.ok(table.every(item => item.name.startsWith('--')), 'A name that is no custom property is left out.');
  // Several names with one value: the first in sorted order wins.
  const two = tokenTable([{ name: '--spacing-b', length: '4px' }, { name: '--spacing-a', length: '4px' }]);
  assert.equal(tokenFor('layout.gap', 4, two), '--spacing-a');
  for (const [property, family] of Object.entries(TOKEN_FAMILIES)) assert.ok(family instanceof RegExp, property);
});

test('compare: tolerances, the token rule and aliases', () => {
  assert.equal(sameValue('layout.gap', 16, 17), true);
  assert.equal(sameValue('layout.gap', 16, 17.5), false);
  assert.equal(sameValue('box.width', 100, 101), true);
  assert.equal(sameValue('type.lineHeight', 1.4, 1.41), true);
  assert.equal(sameValue('type.lineHeight', 1.4, 1.42), false);
  assert.equal(sameValue('type.family', 'Example Sans', 'example sans'), false);
  assert.equal(sameValue('paint.color', '#000000', '#000001'), false);
  assert.equal(sameValue('layout.justify', 'start', 'flex-start'), false);
  assert.equal(sameValue('type.weight', 600, 601), false);
  assert.equal(sameValue('paint.borderColor', null, null), true);
  const a = normaliseRecord(raw(), table);
  const wider = tokenTable([{ name: '--spacing-4', length: '20px' }]);
  const b = normaliseRecord(raw({ columnGap: '20px' }), wider);
  // Both sides name --spacing-4, so the gap matches although the values differ.
  assert.deepEqual(compareRecords('card', a, b).filter(item => item.property === 'layout.gap'), []);
  const renamed = normaliseRecord(raw({ columnGap: '20px' }), tokenTable([{ name: '--gap-4', length: '20px' }]));
  assert.deepEqual(compareRecords('card', a, renamed).filter(item => item.property === 'layout.gap'),
    [{ part: 'card', property: 'layout.gap', kind: 'differs', a: 16, b: 20, tokenA: '--spacing-4', tokenB: '--gap-4' }]);
  assert.deepEqual(compareRecords('card', a, renamed, { '--spacing-4': '--gap-4' }).filter(item => item.property === 'layout.gap'), []);
  assert.equal(sameToken('--x', null), false);
  assert.equal(sameToken('--constructor', '--y', {}), false);
  assert.equal(sameToken('--a', '--b', { '--b': '--a' }), false, 'An alias maps side A to side B only.');
});

const snapshot = (parts) => ({ schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style', parts });
const part = (id, records, repeat = false, count = records.length) => ({ id, repeat, count, records });

test('compare: per part match, differs, missing, and one count finding for a repeat', () => {
  const card = normaliseRecord(raw(), table);
  const a = snapshot([part('title', [card]), part('item', [card, card, card], true), part('gone', [card])]);
  const b = snapshot([part('title', [normaliseRecord(raw({ fontSize: '24px' }), table)]), part('item', [card, card, card, card], true), part('gone', [])]);
  const result = compareLayout(a, b);
  assert.deepEqual(result.parts, [{ id: 'title', state: 'differs' }, { id: 'item', state: 'differs' }, { id: 'gone', state: 'missing' }]);
  assert.deepEqual(result.differences.map(item => [item.part, item.property, item.kind]), [
    ['title', 'type.size', 'differs'], ['title', 'type.lineHeight', 'differs'], ['item', 'count', 'count'], ['gone', 'part', 'missing']]);
  assert.equal(result.differences.find(item => item.property === 'type.size').tokenA, '--text-xl');
  assert.deepEqual(result.counts, { parts: 3, match: 0, differs: 2, missing: 1, count: 1, differences: 4 });
  assert.equal(differenceMessage(result.differences[0]), 'Layout part title type.size: A 20 (--text-xl), B 24.');
  assert.equal(differenceMessage(result.differences[2]), 'Layout part item: count A 3, B 4.');
  const same = compareLayout(a, structuredClone(a));
  assert.equal(same.changed, false);
  assert.deepEqual(same.counts, { parts: 3, match: 3, differs: 0, missing: 0, count: 0, differences: 0 });
  // A repeat item that differs names its index.
  const changed = snapshot([part('title', [card]), part('item', [card, normaliseRecord(raw({ paddingTop: '20px' }), table), card], true), part('gone', [card])]);
  assert.deepEqual(compareLayout(a, changed).differences.map(item => item.part), ['item[1]']);
});

test('declarations: 1 to 50 parts, unique safe IDs, bounded selectors, boolean repeat', () => {
  assert.deepEqual(normalizeLayoutParts({ parts: [{ id: 'card', selector: '.card', repeat: true }, { id: 'title', selector: 'h1', repeat: false }] }),
    { parts: [{ id: 'card', selector: '.card', repeat: true }, { id: 'title', selector: 'h1' }] });
  for (const value of [null, [], { parts: [] }, { parts: Array(51).fill(0).map((_, i) => ({ id: `p${i}`, selector: 'a' })) },
    { parts: [{ id: 'a', selector: 'a' }, { id: 'a', selector: 'b' }] }, { parts: [{ id: '../x', selector: 'a' }] }, { parts: [{ id: 'a', selector: '' }] },
    { parts: [{ id: 'a', selector: 'a\n' }] }, { parts: [{ id: 'a', selector: 'x'.repeat(2049) }] }, { parts: [{ id: 'a', selector: 'a', repeat: 'yes' }] },
    { parts: [{ id: 'a', selector: 'a', extra: 1 }] }, { parts: [{ id: 'a', selector: 'a' }], other: 1 }, { parts: [, { id: 'a', selector: 'a' }] }]) assert.throws(() => normalizeLayoutParts(value), String(JSON.stringify(value)).slice(0, 60));
  assert.deepEqual(normalizeLayoutConfig({}), {});
  assert.deepEqual(normalizeLayoutConfig({ aliases: { '--z': '--b', '--a': '--c' } }), { aliases: { '--a': '--c', '--z': '--b' } });
  for (const value of [null, { other: 1 }, { aliases: [] }, { aliases: { a: '--b' } }, { aliases: { '--a': 'b' } }, { aliases: { '--a': 7 } }]) assert.throws(() => normalizeLayoutConfig(value));
});

test('a stored layout file is untrusted: any shape outside the bounds refuses the whole file', () => {
  const record = normaliseRecord(raw(), table);
  const good = snapshot([part('card', [record], true), part('title', [record])]);
  const copy = validateLayoutSnapshot(good);
  assert.deepEqual(copy, good);
  good.parts[0].records[0].box.width = 1;
  assert.notEqual(copy.parts[0].records[0].box.width, 1, 'The reader returns a copy.');
  const bad = [
    { ...good, version: '0.0.1' }, { ...good, source: 'dom' }, { ...good, extra: 1 }, { ...good, parts: [] },
    snapshot([part('a', [record]), part('a', [record])]),
    snapshot([part('a', [record, record])]),
    snapshot([part('a', [record], true, 2)]),
    snapshot([part('a', Array(51).fill(record), true)]),
    snapshot([{ ...part('a', [record]), count: -1 }]),
    snapshot([part('a', [{ ...record, paint: { ...record.paint, color: 'RED' } }])]),
    snapshot([part('a', [{ ...record, paint: { ...record.paint, color: '#ff0000ff' } }])]),
    snapshot([part('a', [{ ...record, paint: { ...record.paint, color: ' #ff0000' } }])]),
    snapshot([part('a', [{ ...record, paint: { ...record.paint, background: 'x'.repeat(201) } }])]),
    snapshot([part('a', [{ ...record, tokens: { 'box.width': '--x' } }])]),
    snapshot([part('a', [{ ...record, tokens: { 'paint.color': 'x' } }])]),
    snapshot([part('a', [{ ...record, box: { width: Infinity, height: 1 } }])]),
    snapshot([part('a', [{ ...record, type: { ...record.type, family: 'x'.repeat(201) } }])]),
    snapshot([part('a', [{ ...record, layout: { ...record.layout, padding: [1, 2, 3] } }])]),
    snapshot([part('a', [{ ...record, extra: {} }])]),
    JSON.parse('{"schemaVersion":1,"version":"1.0.0","source":"computed-style","parts":[{"id":"a","repeat":false,"count":1,"records":[{"box":{"width":1,"height":1},"layout":{"display":"block","direction":null,"wrap":null,"justify":null,"align":null,"gap":null,"padding":[0,0,0,0]},"type":{"family":null,"size":null,"weight":null,"lineHeight":null,"letterSpacing":null},"paint":{"color":null,"background":null,"borderWidth":null,"borderColor":null,"radius":null},"tokens":{"__proto__":"--x"}}]}]}'),
  ];
  for (const value of bad) assert.throws(() => validateLayoutSnapshot(value));
  // A repeat may count more elements than it stores: the first 50 are kept.
  assert.equal(validateLayoutSnapshot(snapshot([part('a', Array(50).fill(record), true, 80)])).parts[0].count, 80);
});

test('the snapshot builder turns raw page values into the stored shape', () => {
  const result = layoutSnapshot({ parts: [{ id: 'card', repeat: true, count: 2, raw: [raw(), raw({ columnGap: '8px' })] }],
    tokens: [{ name: '--spacing-2', length: '8px', colour: null }] });
  assert.equal(validateLayoutSnapshot(result).parts[0].records[1].tokens['layout.gap'], '--spacing-2');
  assert.equal(result.parts[0].records[0].tokens['layout.gap'], undefined);
});
