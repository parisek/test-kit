import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecord, validateRecord, approvalBlockers, requirementIdsFrom, MARKER } from '../../scripts/milestone/records.js';

const sha = 'a'.repeat(40);
const base = () => ({
	mode: 'pr', reviewer: 'claude', sha, verdict: 'fits', principle: 9, tier: 1, requirements: ['R10.10'], default_behavior: 'none',
	evidence: ['diff'], unverified: ['browser run'], security: 'none', unexpected_files: 'none', tests: 'present', risk: 'none', citations: ['docs/specification.md:255'],
});
const comment = (record) => `${MARKER}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n\nFindings: none.`;
const ids = new Set(['R10.10', 'R6.10']);

test('a complete record parses, validates and counts as an approval', () => {
	const parsed = parseRecord(comment(base()));
	assert.equal(parsed.ok, true);
	assert.deepEqual(validateRecord(parsed.record, { headSha: sha, requirementIds: ids }), { ok: true, errors: [] });
	assert.deepEqual(approvalBlockers(parsed.record), []);
});

test('the parser refuses a missing marker, zero blocks, two blocks and bad JSON', () => {
	assert.equal(parseRecord('```json\n{}\n```').ok, false);
	assert.equal(parseRecord(`${MARKER}\nno block`).ok, false);
	const one = comment(base());
	assert.equal(parseRecord(`${one}\n${one.split('\n').slice(1).join('\n')}`).ok, false);
	assert.equal(parseRecord(`${MARKER}\n\`\`\`json\n{ nope\n\`\`\``).ok, false);
	assert.equal(parseRecord(`${MARKER}\n\`\`\`json\n[]\n\`\`\``).ok, false);
	assert.equal(parseRecord(null).ok, false);
});

test('the validator refuses a missing field, an unknown field and a bad value', () => {
	const cases = [
		[(r) => { delete r.evidence; }, /Missing field: evidence/],
		[(r) => { r.extra = 1; }, /Unknown field: extra/],
		[(r) => { r.verdict = 'maybe'; }, /verdict must be/],
		[(r) => { r.reviewer = 'bot'; }, /reviewer must be/],
		[(r) => { r.tier = 4; }, /tier must be/],
		[(r) => { r.sha = 'abc'; }, /sha must be 40 hex/],
		[(r) => { r.sha = 'b'.repeat(40); }, /differs from the head SHA/],
		[(r) => { r.evidence = []; }, /evidence must be a non-empty list/],
		[(r) => { r.unverified = ['']; }, /unverified must be a non-empty list/],
		[(r) => { r.requirements = ['G3']; }, /not an R-number/],
		[(r) => { r.requirements = ['R99.9']; }, /not in the specification/],
		[(r) => { r.citations = ['/etc/passwd:1']; }, /not path:line/],
		[(r) => { r.citations = ['../x:1']; }, /not path:line/],
		[(r) => { r.citations = ['file']; }, /not path:line/],
		[(r) => { r.tests = 'maybe'; }, /tests must be/],
		[(r) => { r.risk = ''; }, /risk must be non-empty/],
	];
	for (const [mutate, pattern] of cases) {
		const record = base();
		mutate(record);
		const result = validateRecord(record, { headSha: sha, requirementIds: ids });
		assert.equal(result.ok, false, String(pattern));
		assert.match(result.errors.join('\n'), pattern);
	}
});

test('requirements accepts the single entry none, and tests accepts "none: reason"', () => {
	const record = base();
	record.requirements = ['none'];
	record.tests = 'none: ci only';
	assert.equal(validateRecord(record, { headSha: sha, requirementIds: ids }).ok, true);
	record.requirements = ['none', 'R10.10'];
	assert.equal(validateRecord(record, { headSha: sha, requirementIds: ids }).ok, false);
});

test('a record in mode issue needs no sha and never counts as a merge review', () => {
	const record = { mode: 'issue', reviewer: 'claude', verdict: 'fits', principle: 9, tier: 1, requirements: ['R10.10'], default_behavior: 'none', security: 'none', risk: 'none', citations: ['docs/vision.md:219'] };
	assert.equal(validateRecord(record, { requirementIds: ids }).ok, true);
	assert.match(approvalBlockers(record).join(' '), /never counts/);
});

test('every content rule blocks an approval', () => {
	const cases = [
		[{ verdict: 'needs-owner' }, /verdict is needs-owner/],
		[{ verdict: 'conflicts' }, /verdict is conflicts/],
		[{ reviewer: 'author' }, /author is not a reviewer/],
		[{ tier: 3 }, /tier is 3/],
		[{ default_behavior: 'runs by default' }, /default_behavior/],
		[{ security: 'src/capture/x.js' }, /security/],
		[{ unexpected_files: 'a.txt' }, /unexpected_files/],
		[{ risk: 'regression' }, /risk/],
		[{ tests: 'none: later' }, /tests/],
	];
	for (const [patch, pattern] of cases) assert.match(approvalBlockers({ ...base(), ...patch }).join(' '), pattern);
});

test('requirementIdsFrom reads the numbered requirements of the specification', () => {
	const found = requirementIdsFrom(readFileSync(new URL('../../docs/specification.md', import.meta.url), 'utf8'));
	for (const id of ['R10.10', 'R11.6', 'R8.12']) assert.equal(found.has(id), true, id);
	assert.equal(found.has('R99.99'), false);
});
