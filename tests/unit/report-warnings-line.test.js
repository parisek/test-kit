import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReport } from '../../src/query/summary.js';
import { warningTotals, captureWarningsSentence, cellWarningsText } from '../../src/report/warnings.js';
import { headerLine } from '../../src/report/scope.js';

// R5.11, #329: the viewer sentence and the cell detail. The counts come from warningTotals, as in `summary`.
const CODE = 'LAZY_IMAGES_NOT_SWEPT';
const report = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, causes: [], findings: [], entries: [] });
const row = (warnings) => ({ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, ...(warnings === undefined ? {} : { warnings }) });

test('the header sentence names each code with the cells and the count of summary', () => {
	const data = report();
	data.entries = [
		{ id: 'home', viewports: [row({ a: [{ code: CODE, count: 3 }], b: [{ code: CODE, count: 4 }] })] },
		{ id: 'about', viewports: [row({ a: [{ code: CODE, count: 2 }], b: [] })] },
	];
	const [item] = summarizeReport(data).captureWarnings;
	assert.deepEqual(item, { code: CODE, cells: 3, count: 9 });
	assert.equal(captureWarningsSentence(warningTotals(data)), `Capture warnings: ${CODE} in ${item.cells} cells (${item.count} in all).`);
	assert.equal(headerLine(data), 'Capture warnings: LAZY_IMAGES_NOT_SWEPT in 3 cells (9 in all).');
});

test('the sentence uses the singular, joins codes and cuts the list after 5 codes', () => {
	assert.equal(captureWarningsSentence([{ code: 'CODE_A', cells: 1, count: 1 }, { code: 'CODE_B', cells: 2, count: 5 }]), 'Capture warnings: CODE_A in 1 cell (1 in all); CODE_B in 2 cells (5 in all).');
	const many = 'ABCDEFG'.split('').map((letter) => ({ code: `CODE_${letter}`, cells: 1, count: 1 }));
	assert.match(captureWarningsSentence(many), /CODE_E in 1 cell \(1 in all\) and 2 more codes\.$/);
	assert.match(captureWarningsSentence(many.slice(0, 6)), / and 1 more code\.$/);
});

test('no valid warning gives no sentence and the header line keeps its old value', () => {
	const data = report();
	data.entries = [{ id: 'home', viewports: [row({ a: [{ code: CODE, count: -1 }], b: 'x' })] }, { id: 'about', viewports: [row('x')] }];
	assert.equal(captureWarningsSentence(warningTotals(data)), '');
	assert.equal(headerLine(data), null);
	assert.equal(headerLine({ meta: {}, runs: [] }), null);
});

test('the header line puts the warnings after the other sentences', () => {
	const data = report();
	data.runs[0].noFixture = ['hero'];
	data.entries = [{ id: 'home', viewports: [row({ a: [{ code: CODE, count: 1 }], b: [] })] }];
	assert.equal(headerLine(data), 'Not compared: 1 component has no fixture. Capture warnings: LAZY_IMAGES_NOT_SWEPT in 1 cell (1 in all).');
});

test('the cell detail names both sides and validates the shape of untrusted data', () => {
	assert.equal(cellWarningsText(row({ a: [{ code: CODE, count: 7 }], b: [] })), 'A: LAZY_IMAGES_NOT_SWEPT (7) · B: none');
	assert.equal(cellWarningsText(row({ a: [], b: [{ code: CODE, count: 2 }, { code: 'OTHER', count: 1 }] })), 'A: none · B: LAZY_IMAGES_NOT_SWEPT (2), OTHER (1)');
	assert.equal(cellWarningsText(row({ a: [{ code: CODE, count: 7 }], b: 'x' })), 'A: LAZY_IMAGES_NOT_SWEPT (7) · B: none');
	for (const bad of [undefined, null, 'x', 5, [], { a: [{ code: 'bad code', count: 1 }], b: [{ code: CODE, count: 0 }] }, { a: [{ code: CODE, count: 1, extra: 1 }] }]) {
		assert.equal(cellWarningsText(row(bad)), null);
	}
	assert.equal(cellWarningsText(undefined), null);
});
