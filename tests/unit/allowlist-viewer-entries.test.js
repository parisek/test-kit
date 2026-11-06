import test from 'node:test';
import assert from 'node:assert/strict';
import { allowlistEntriesFor, MAX_REPORT_ENTRIES } from '../../src/allowlist/model.js';

// R9.12, #331: the entries the viewer lists for one target. The report is untrusted, so a bad entry is left out.
const hash = (char) => `sha256:${char.repeat(64)}`;
const entry = (extra = {}) => ({ checkId: 'a11y-axe', targetId: 'button', fingerprint: hash('a'), reason: 'Known contrast issue.', owner: 'team-a', status: 'active', ...extra });

test('lists the valid entries of one target and keeps the report order', () => {
	const report = { allowlist: [entry(), entry({ targetId: 'card' }), entry({ fingerprint: hash('b'), status: 'stale', diagnostic: 'No finding has this fingerprint.', expires: '2027-01-31' })] };
	assert.deepEqual(allowlistEntriesFor(report, 'button').map((item) => [item.fingerprint, item.status]), [[hash('a'), 'active'], [hash('b'), 'stale']]);
	assert.deepEqual(allowlistEntriesFor(report, 'card').length, 1);
	assert.deepEqual(allowlistEntriesFor(report, 'none'), []);
});

test('leaves out an entry with a bad shape, a bad status or a bad text', () => {
	const bad = [entry({ status: 'ok' }), entry({ status: undefined }), entry({ reason: '' }), entry({ owner: 'x\ny' }), entry({ fingerprint: 'sha256:abc' }), entry({ extra: 1 }),
		entry({ expires: '2027-02-30' }), entry({ diagnostic: 5 }), entry({ checkId: 'bad id' }), 'x', null, 7, [entry()]];
	assert.deepEqual(allowlistEntriesFor({ allowlist: bad }, 'button'), []);
	for (const allowlist of [undefined, null, 'x', {}, 5]) assert.deepEqual(allowlistEntriesFor({ allowlist }, 'button'), []);
	assert.deepEqual(allowlistEntriesFor(undefined, 'button'), []);
});

test('reads at most the bound of one report', () => {
	const many = Array.from({ length: MAX_REPORT_ENTRIES + 20 }, (_, index) => entry({ fingerprint: `sha256:${String(index).padStart(64, '0')}` }));
	assert.equal(allowlistEntriesFor({ allowlist: many }, 'button').length, MAX_REPORT_ENTRIES);
});
