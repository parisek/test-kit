import { describe, expect, it } from 'vitest';
import { formatRatio } from './format.js';

describe('pixel difference ratio', () => {
	it('shows at most two decimals', () => {
		expect(formatRatio(18.2)).toBe('18.2%');
		expect(formatRatio(1)).toBe('1%');
		expect(formatRatio(0.123)).toBe('0.12%');
		expect(formatRatio(0)).toBe('0%');
	});
	it('never shows a small difference as none', () => {
		expect(formatRatio(0.004)).toBe('<0.01%');
		expect(formatRatio(0.0001)).toBe('<0.01%');
	});
	it('uses one rule at every edge value', () => {
		const cases = [[0, '0%'], [0.004, '<0.01%'], [0.007, '0.01%'], [0.38, '0.38%'], [99.994, '99.99%'], [99.996, '>99.99%'], [100, '100%']];
		for (const [value, text] of cases) expect(formatRatio(value)).toBe(text);
	});
	it('gives null for a missing ratio', () => {
		for (const value of [null, undefined, Number.NaN, '1']) expect(formatRatio(value)).toBeNull();
	});
});
