import { describe, expect, it } from 'vitest';
import { changeText, groupByDay, historyStrip, homeRows, latestRow, localDay, rowClass, verdictSentence } from './home-model.js';
import { parseIndex } from './index-list.js';

const summary = (extra = {}) => ({ unexplained: 0, explained: 0, match: 0, oracle: 0, unclassified: 0, incomplete: 0, ...extra });
const hashA = 'sha256:' + 'a'.repeat(12);
const hashB = 'sha256:' + 'b'.repeat(12);
const row = (id, createdAt, extra = {}) => ({ id, createdAt, available: true, settingsHash: hashA, summary: summary({ match: 3 }), ...extra });

describe('index summary fields (R10.13)', () => {
	const entry = (extra) => ({ id: 'a', kind: 'convergence', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: null, path: 'reports/a/report.json', targets: 3, ...extra });
	const parse = (extra) => parseIndex({ schemaVersion: 1, reports: [entry(extra)], runs: [] }).reports[0];
	it('reads viewports and a full summary', () => {
		const result = parse({ viewports: 2, summary: summary({ match: 2, unexplained: 1, incomplete: 1 }) });
		expect(result.viewports).toBe(2);
		expect(result.summary).toEqual(summary({ match: 2, unexplained: 1, incomplete: 1 }));
	});
	it('keeps an old index without the fields valid and shows them as unknown', () => {
		expect(parse({})).toMatchObject({ viewports: null, summary: null });
	});
	it('treats a summary with any bad count as unknown, never as 0', () => {
		for (const bad of [null, [], 'x', summary({ match: -1 }), summary({ match: 1.5 }), { match: 1 }, summary({ oracle: '1' })]) {
			expect(parse({ summary: bad }).summary).toBeNull();
		}
		expect(parse({ viewports: -1 }).viewports).toBeNull();
	});
});

describe('row class and verdict sentence', () => {
	it('takes the worst class over the targets (R8.12)', () => {
		expect(rowClass(summary({ match: 3, explained: 1, unexplained: 1 }))).toBe('unexplained');
		expect(rowClass(summary({ match: 3, explained: 1 }))).toBe('explained');
		expect(rowClass(summary({ match: 3, oracle: 1 }))).toBe('oracle');
		expect(rowClass(summary({ match: 3 }))).toBe('match');
		expect(rowClass(summary({ unclassified: 2, incomplete: 2 }))).toBe('unclassified');
		// An unmeasured page is never hidden behind the match color.
		expect(rowClass(summary({ match: 3, unclassified: 1, incomplete: 1 }))).toBe('unclassified');
		expect(rowClass(summary({ explained: 1, unclassified: 1 }))).toBe('explained');
		expect(rowClass(summary())).toBeNull();
		expect(rowClass(null)).toBeNull();
	});
	it('puts the verdict in words', () => {
		expect(verdictSentence(summary({ match: 3 }))).toBe('Nothing changed');
		expect(verdictSentence(summary({ match: 2, unexplained: 1 }))).toBe('1 page differs without an explanation');
		expect(verdictSentence(summary({ unexplained: 2 }))).toBe('2 pages differ without an explanation');
		expect(verdictSentence(summary({ match: 2, explained: 1 }))).toBe('1 page has only known differences');
		expect(verdictSentence(summary({ match: 2, unclassified: 1, incomplete: 1 }))).toBe('1 page is not measured. 1 page is incomplete');
		// Incomplete overlaps the classes: it never reads as "Nothing changed".
		expect(verdictSentence(summary({ match: 2, incomplete: 1 }))).toBe('No difference found. 1 page is incomplete');
		expect(verdictSentence(summary({ unexplained: 1, match: 1, incomplete: 2 }))).toBe('1 page differs without an explanation. 2 pages are incomplete');
		expect(verdictSentence(summary({ oracle: 2 }))).toBe('2 pages need a check by a person');
		expect(verdictSentence(summary({ match: 3, oracle: 1 }))).toBe('1 page needs a check by a person');
		expect(verdictSentence(summary())).toBe('No pages');
		expect(verdictSentence(null)).toBe('Not measured');
	});
});

describe('change against the previous comparison', () => {
	it('names each class that changed', () => {
		expect(changeText(summary({ match: 2, unexplained: 1 }), summary({ match: 3 }))).toBe('+1 unexplained, −1 match');
		expect(changeText(summary({ match: 3 }), summary({ match: 3 }))).toBe('Same as before');
		expect(changeText(summary({ match: 3, oracle: 1 }), summary({ match: 3 }))).toBe('+1 oracle');
		expect(changeText(summary({ match: 3, unclassified: 1, incomplete: 1 }), summary({ match: 3 }))).toBe('+1 unclassified, +1 incomplete');
	});
	it('says nothing when a summary is unknown', () => {
		expect(changeText(null, summary())).toBeNull();
		expect(changeText(summary(), null)).toBeNull();
	});
});

describe('home rows', () => {
	it('compares each row with the next older available row and marks a new settings hash', () => {
		const rows = homeRows([
			row('c', '2026-10-03T09:00:00.000Z', { summary: summary({ match: 2, unexplained: 1 }), settingsHash: hashB }),
			row('b', '2026-10-02T09:00:00.000Z', { available: false, summary: null }),
			row('a', '2026-10-01T09:00:00.000Z'),
		], { timeZone: 'UTC' });
		expect(rows[0]).toMatchObject({ verdict: 'unexplained', change: '+1 unexplained, −1 match', hashChanged: true, day: '2026-10-03' });
		expect(rows[1]).toMatchObject({ verdict: null, change: null, incomplete: null });
		expect(rows[2]).toMatchObject({ change: null, hashChanged: false });
	});
	it('carries the incomplete count beside the class and shows no verdict on an unavailable row', () => {
		const rows = homeRows([
			row('b', null, { summary: summary({ match: 2, incomplete: 1 }) }),
			row('a', null, { available: false, summary: summary({ unexplained: 1 }) }),
		]);
		expect(rows[0]).toMatchObject({ verdict: 'match', incomplete: 1 });
		expect(rows[1]).toMatchObject({ verdict: null, incomplete: null, change: null });
	});
	it('does not mark a hash change when a hash is unknown', () => {
		const rows = homeRows([row('b', null, { settingsHash: null }), row('a', null)]);
		expect(rows[0].hashChanged).toBe(false);
	});
	it('groups rows by local day and puts rows without a time last', () => {
		const rows = homeRows([
			row('d', '2026-10-03T23:30:00.000Z'),
			row('c', '2026-10-03T08:00:00.000Z'),
			row('b', '2026-10-02T09:00:00.000Z'),
			row('x', null),
		], { timeZone: 'Europe/Prague' });
		expect(groupByDay(rows).map((group) => [group.day, group.rows.map((item) => item.id)])).toEqual([
			['2026-10-04', ['d']],
			['2026-10-03', ['c']],
			['2026-10-02', ['b']],
			[null, ['x']],
		]);
	});
	it('reads a local day and refuses a bad time', () => {
		expect(localDay('2026-10-03T23:30:00.000Z', 'UTC')).toBe('2026-10-03');
		expect(localDay('2026-10-03T23:30:00.000Z', 'Europe/Prague')).toBe('2026-10-04');
		expect(localDay('not a time', 'UTC')).toBeNull();
		expect(localDay(null, 'UTC')).toBeNull();
	});
	it('picks the latest available comparison and builds the strip oldest first', () => {
		const rows = homeRows([row('c', null, { available: false }), row('b', null), row('a', null)]);
		expect(latestRow(rows).id).toBe('b');
		expect(historyStrip(rows).map((item) => item.id)).toEqual(['a', 'b']);
		expect(historyStrip(rows, 1).map((item) => item.id)).toEqual(['b']);
		expect(latestRow([])).toBeNull();
		expect(homeRows(null)).toEqual([]);
	});
});
