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
	it('gives null for a missing ratio', () => {
		for (const value of [null, undefined, Number.NaN, '1']) expect(formatRatio(value)).toBeNull();
	});
});
