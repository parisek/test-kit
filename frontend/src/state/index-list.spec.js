import { describe, expect, it } from 'vitest';
import { anchorFor, idFromAnchor, parseIndex, shortHash, validId } from './index-list.js';

const hash = 'sha256:' + 'ab12cd34ef56'.repeat(5) + 'abcd';
const row = (id, extra = {}) => ({
	id, kind: 'convergence', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: hash,
	path: `reports/${id}/report.json`, targets: 3, ...extra,
});
const index = (extra = {}) => ({ schemaVersion: 1, generatedAt: '2026-10-03T08:00:00.000Z', reports: [], runs: [], ...extra });

describe('publish directory index', () => {
	it('keeps the order of the file and shortens the settings hash', () => {
		const result = parseIndex(index({ reports: [row('b'), row('a'), row('c')] }));
		expect(result.ok).toBe(true);
		expect(result.reports.map((item) => item.id)).toEqual(['b', 'a', 'c']);
		expect(result.reports[0]).toMatchObject({ kind: 'convergence', targets: 3, available: true });
		expect(result.reports[0].settingsHash).toBe(hash.slice(0, 19));
	});
	it('marks a null path or a foreign path as unavailable', () => {
		const result = parseIndex(index({ reports: [
			row('a', { path: null }),
			row('b', { path: 'reports/other/report.json' }),
			row('c', { path: '../report.json' }),
			row('d', { path: 'https://example.invalid/report.json' }),
		] }));
		expect(result.reports.map((item) => item.available)).toEqual([false, false, false, false]);
	});
	it('refuses an unknown schemaVersion and does not guess', () => {
		for (const schemaVersion of [2, 0, '1', null, undefined]) {
			const result = parseIndex(index({ schemaVersion, reports: [row('a')] }));
			expect(result.ok).toBe(false);
			expect(result.error).toMatch(/^Unsupported index schemaVersion/);
		}
		expect(parseIndex([]).ok).toBe(false);
		expect(parseIndex(null).ok).toBe(false);
	});
	it('validates the id with the history id charset', () => {
		expect(validId('a')).toBe(true);
		expect(validId('A_b-9')).toBe(true);
		expect(validId('a'.repeat(160))).toBe(true);
		for (const bad of ['', '-a', '_a', 'a b', 'a/b', '..', 'a.b', 'a'.repeat(161), 7, null, '<b>']) expect(validId(bad)).toBe(false);
		const result = parseIndex(index({ reports: [row('good'), row('../x'), row('<img src=x>'), { path: 'x' }, null] }));
		expect(result.reports.map((item) => item.id)).toEqual(['good']);
		expect(result.skipped).toBe(4);
	});
	it('turns unknown or wrongly typed fields into null', () => {
		const result = parseIndex(index({ reports: [row('a', { kind: 7, createdAt: 'yesterday', settingsHash: 'md5:1', targets: -1 })], extra: 1 }));
		expect(result.reports[0]).toMatchObject({ kind: null, createdAt: null, settingsHash: null, targets: null });
		expect(parseIndex(index({ reports: 'x', runs: {} }))).toMatchObject({ ok: true, reports: [], runs: [] });
	});
	it('lists runs as unavailable unless the run path is exact', () => {
		const result = parseIndex(index({ runs: [
			{ id: 'r1', createdAt: null, settingsHash: hash, path: 'runs/r1/run.json' },
			{ id: 'r2', createdAt: null, settingsHash: null, path: null },
		] }));
		expect(result.runs.map((item) => item.available)).toEqual([true, false]);
	});
	it('reads and writes only plain anchors', () => {
		expect(anchorFor('example-a')).toBe('#r-example-a');
		expect(idFromAnchor('#r-example-a')).toBe('example-a');
		for (const bad of ['', '#', '#r-', '#r-../x', '#r-a b', '#report=a', '#r-<x>', null, undefined]) expect(idFromAnchor(bad)).toBeNull();
		expect(shortHash('sha256:xyz')).toBeNull();
	});
});
