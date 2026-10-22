import { describe, expect, it } from 'vitest';
import { localDateTime, reportNeighbors } from './report-nav.js';

const row = (id, available = true) => ({ id, available });

describe('older and newer comparisons (R10.3)', () => {
	const reports = [row('d'), row('c', false), row('b'), row('a')];
	it('skips unavailable entries and counts only available ones', () => {
		expect(reportNeighbors(reports, 'd')).toMatchObject({ position: 1, total: 3, newer: null, older: { id: 'b' } });
		expect(reportNeighbors(reports, 'b')).toMatchObject({ position: 2, total: 3, newer: { id: 'd' }, older: { id: 'a' } });
		expect(reportNeighbors(reports, 'a')).toMatchObject({ position: 3, total: 3, newer: { id: 'b' }, older: null });
	});
	it('gives no navigation for an unknown or unavailable id', () => {
		expect(reportNeighbors(reports, 'c')).toBeNull();
		expect(reportNeighbors(reports, 'x')).toBeNull();
		expect(reportNeighbors(null, 'a')).toBeNull();
	});
});

describe('local date and time', () => {
	it('reads an ISO time and refuses anything else', () => {
		expect(localDateTime('2026-10-22T07:15:00.000Z')).toEqual(expect.any(String));
		expect(localDateTime('nope')).toBeNull();
		expect(localDateTime(null)).toBeNull();
	});
});
