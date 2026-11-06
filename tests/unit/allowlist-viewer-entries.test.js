import test from 'node:test';
import assert from 'node:assert/strict';
import { allowlistEntriesFor, reportEntryProblem, validateReportAllowlist, MAX_REPORT_ENTRIES } from '../../src/allowlist/model.js';

// R9.12, #331: the entries the viewer lists for one target. The report is untrusted, so an entry that the producer check rejects is left out.
const hash = (char) => `sha256:${char.repeat(64)}`;
const entry = (extra = {}) => ({ checkId: 'a11y-axe', targetId: 'button', fingerprint: hash('a'), reason: 'Known contrast issue.', owner: 'team-a', status: 'active', ...extra });
const base = (allowlist) => ({
	checks: { 'a11y-axe': { basis: 'absolute' }, 'text-difference': { basis: 'relative' } },
	entries: [{ id: 'button' }, { id: 'card' }],
	allowlist,
});

test('lists the valid entries of one target and keeps the report order', () => {
	const report = base([entry(), entry({ targetId: 'card' }), entry({ fingerprint: hash('b'), status: 'stale', diagnostic: 'No finding has this fingerprint.', expires: '2027-01-31' })]);
	assert.deepEqual(allowlistEntriesFor(report, 'button').map((item) => [item.fingerprint, item.status]), [[hash('a'), 'active'], [hash('b'), 'stale']]);
	assert.equal(allowlistEntriesFor(report, 'card').length, 1);
	assert.deepEqual(allowlistEntriesFor(report, 'none'), []);
});

test('leaves out every entry that the producer check rejects', () => {
	const bad = [
		entry({ checkId: 'not-in-catalog' }),
		entry({ checkId: 'text-difference', status: 'active' }),
		entry({ targetId: 'ghost' }),
		entry({ status: 'ok' }), entry({ status: undefined }), entry({ reason: '' }), entry({ owner: 'x\ny' }), entry({ fingerprint: 'sha256:abc' }), entry({ extra: 1 }),
		entry({ expires: '2027-02-30' }), entry({ diagnostic: 5 }), entry({ checkId: 'bad id' }), 'x', null, 7, [entry()],
	];
	for (const item of bad) assert.deepEqual(allowlistEntriesFor(base([item]), item?.targetId ?? 'button'), [], JSON.stringify(item));
	assert.deepEqual(allowlistEntriesFor({ ...base([entry({ targetId: 'ghost' })]), entries: [{ id: 'button' }] }, 'ghost'), []);
	for (const allowlist of [undefined, null, 'x', {}, 5]) assert.deepEqual(allowlistEntriesFor(base(allowlist), 'button'), []);
	assert.deepEqual(allowlistEntriesFor(undefined, 'button'), []);
	assert.deepEqual(allowlistEntriesFor({ allowlist: [entry()] }, 'button'), [], 'no catalog and no targets means no entry');
});

test('a relative check keeps a stale entry (wrong-basis) but never an active one', () => {
	const report = base([entry({ checkId: 'text-difference', status: 'wrong-basis' }), entry({ checkId: 'text-difference', status: 'active', fingerprint: hash('c') })]);
	assert.deepEqual(allowlistEntriesFor(report, 'button').map((item) => item.status), ['wrong-basis']);
});

test('the viewer and the report validator share one entry check', () => {
	const context = { catalog: base().checks, targetIds: new Set(['button']) };
	for (const item of [entry(), entry({ checkId: 'x' }), entry({ targetId: 'ghost' }), entry({ checkId: 'text-difference' }), entry({ status: 'ok' })]) {
		const problems = [];
		validateReportAllowlist([item], context, problems);
		assert.deepEqual(problems, reportEntryProblem(item, context) ? [reportEntryProblem(item, context)] : []);
	}
});

test('reads at most the bound of one report', () => {
	const many = Array.from({ length: MAX_REPORT_ENTRIES + 20 }, (_, index) => entry({ fingerprint: `sha256:${String(index).padStart(64, '0')}` }));
	assert.equal(allowlistEntriesFor(base(many), 'button').length, MAX_REPORT_ENTRIES);
});
