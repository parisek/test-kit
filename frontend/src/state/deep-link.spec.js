import { describe, expect, it } from 'vitest';
import { buildDeepLink, parseDeepLink } from './deep-link.js';

const base = { reportId: 'example-a', view: 'overview', targetId: null, viewportId: null, artifact: null, findingId: null, mode: null, notice: null };
const link = (extra) => ({ ...base, ...extra });

describe('deep link parse (R10.14)', () => {
	it('reads a full link and decodes each part', () => {
		expect(parseDeepLink('#r-example-a/evidence/%40project/desktop/screenshot/f%2F1?mode=overlay')).toEqual(link({
			view: 'evidence', targetId: '@project', viewportId: 'desktop', artifact: 'screenshot', findingId: 'f/1', mode: 'overlay',
		}));
	});
	it('keeps the plain report link valid and opens the Overview', () => {
		expect(parseDeepLink('#r-example-a')).toEqual(base);
		expect(parseDeepLink('#r-example-a/')).toEqual(base);
	});
	it('ignores the target, viewport, artifact, finding and mode parts on overview and info', () => {
		expect(parseDeepLink('#r-example-a/info/home/desktop/html/f1?mode=overlay')).toEqual(link({ view: 'info' }));
		expect(parseDeepLink('#r-example-a/overview/home')).toEqual(base);
		expect(parseDeepLink('#r-example-a/info/%E0%A4%A/a/b/c/d/e')).toEqual(link({ view: 'info' }));
	});
	it('treats an omitted trailing part and an empty middle part as missing', () => {
		expect(parseDeepLink('#r-example-a/evidence/home')).toEqual(link({ view: 'evidence', targetId: 'home' }));
		expect(parseDeepLink('#r-example-a/findings/home/desktop//f1')).toEqual(link({
			view: 'findings', targetId: 'home', viewportId: 'desktop', findingId: 'f1',
		}));
		expect(parseDeepLink('#r-example-a//home')).toEqual(base);
	});
	it('accepts every evidence type of R10.4', () => {
		for (const artifact of ['screenshot', 'html', 'status', 'content', 'lighthouse']) {
			expect(parseDeepLink(`#r-example-a/evidence/home/desktop/${artifact}`).artifact).toBe(artifact);
		}
	});
	it('ignores a mode where it does not apply, even an unknown one', () => {
		expect(parseDeepLink('#r-example-a?mode=blink')).toEqual(base);
		expect(parseDeepLink('#r-example-a/info?mode=blink')).toEqual(link({ view: 'info' }));
		expect(parseDeepLink('#r-example-a/evidence/home/desktop/html?mode=blink').notice).toBeNull();
	});
	it('keeps an id with a colon that is not a URL', () => {
		expect(parseDeepLink('#r-example-a/findings/home/desktop/content/content-home-desktop-a11y%3Acontrast-0').findingId)
			.toBe('content-home-desktop-a11y:contrast-0');
		expect(buildDeepLink({ reportId: 'example-a', view: 'findings', findingId: 'check:x' })).toBe('#r-example-a/findings////check%3Ax');
	});
	it('accepts one trailing slash', () => {
		expect(parseDeepLink('#r-example-a/evidence/home/desktop/screenshot/f1/').findingId).toBe('f1');
	});
	it('applies the mode to screenshot only', () => {
		expect(parseDeepLink('#r-example-a/evidence/home/desktop/html?mode=overlay').mode).toBeNull();
		expect(parseDeepLink('#r-example-a/evidence/home?mode=difference').mode).toBe('difference');
		expect(parseDeepLink('#r-example-a/evidence?other=1&mode=side-by-side').mode).toBe('side-by-side');
	});
	it('opens the Overview of the report with a notice for an unknown or unreadable part', () => {
		for (const hash of [
			'#r-example-a/compare',
			'#r-example-a/evidence/home/desktop/video',
			'#r-example-a/evidence/home/desktop/screenshot?mode=blink',
			'#r-example-a/evidence/%E0%A4%A',
			'#r-example-a/evidence/home?mode=%E0%A4%A',
			'#r-example-a/evidence/a/b/screenshot/f1/extra',
		]) {
			const result = parseDeepLink(hash);
			expect(result).toMatchObject({ reportId: 'example-a', view: 'overview', targetId: null, artifact: null, mode: null });
			expect(result.notice).toEqual(expect.any(String));
		}
	});
	it('opens the Home with a notice for an invalid report id', () => {
		for (const hash of ['#r-', '#r-../x', '#r-a%20b', '#r-%3Cx%3E', '#r-%E0%A4%A']) {
			const result = parseDeepLink(hash);
			expect(result.reportId).toBeNull();
			expect(result.notice).toEqual(expect.any(String));
		}
	});
	it('returns null for a hash that is not a deep link', () => {
		for (const hash of ['', '#', '#report=a', '#evidence', null, undefined, 42]) expect(parseDeepLink(hash)).toBeNull();
	});
	it('never takes a URL as a part', () => {
		for (const hash of [
			'#r-example-a/https%3A%2F%2Fexample.invalid',
			'#r-example-a/evidence/https%3A%2F%2Fexample.invalid',
			'#r-example-a/evidence/home/%2F%2Fexample.invalid',
			'#r-example-a/findings/home/desktop//javascript%3Aalert(1)',
			'#r-example-a/overview/https%3A%2F%2Fexample.invalid',
			'#r-example-a/info/home//https:',
			'#r-example-a?mode=https%3A%2F%2Fexample.invalid',
			'#r-example-a/info?mode=javascript%3Aalert(1)',
			'#r-example-a/evidence/home/desktop/html?mode=%2F%2Fexample.invalid',
			'#r-example-a/evidence?next=https%3A%2F%2Fexample.invalid',
			'#r-example-a/evidence/%20https%3A%2F%2Fexample.invalid',
			'#r-example-a/evidence/%09javascript%3Ax',
			'#r-example-a/evidence/%5C%5Cexample.invalid',
			'#r-example-a/evidence/a%3A%2F%2Fb',
			'#r-example-a/evidence/%2F%5Cexample.invalid',
			'#r-example-a/evidence/java%09script%3A1',
			'#r-example-a/evidence/jav%0Aascript%3A1',
			'#r-example-a/evidence/%E2%80%8Bjavascript%3A1',
			'#r-example-a/info/about%3Ablank',
			'#r-example-a?view-source%3Ax=1',
		]) {
			const result = parseDeepLink(hash);
			expect(result).toMatchObject({ reportId: 'example-a', view: 'overview', targetId: null, findingId: null });
			expect(result.notice).toEqual(expect.any(String));
		}
	});
	it('drops the report part next to an adjacent report.json', () => {
		expect(parseDeepLink('#evidence/home/desktop/status', { adjacent: true })).toEqual(link({
			reportId: null, view: 'evidence', targetId: 'home', viewportId: 'desktop', artifact: 'status',
		}));
		expect(parseDeepLink('#r-example-a', { adjacent: true }).notice).toEqual(expect.any(String));
	});
});

describe('deep link build (R10.14)', () => {
	it('builds the plain report link for the Overview', () => {
		expect(buildDeepLink({ reportId: 'example-a' })).toBe('#r-example-a');
		expect(buildDeepLink({ reportId: 'example-a', view: 'overview', targetId: 'home' })).toBe('#r-example-a');
		expect(buildDeepLink({ reportId: 'example-a', view: 'info' })).toBe('#r-example-a/info');
	});
	it('encodes each part, keeps empty middle parts and omits trailing ones', () => {
		expect(buildDeepLink({
			reportId: 'example-a', view: 'evidence', targetId: '@project', viewportId: 'desktop', artifact: 'screenshot', findingId: 'f/1?x', mode: 'overlay',
		})).toBe('#r-example-a/evidence/%40project/desktop/screenshot/f%2F1%3Fx?mode=overlay');
		expect(buildDeepLink({ reportId: 'example-a', view: 'findings', targetId: 'home', viewportId: 'desktop', findingId: 'f1' }))
			.toBe('#r-example-a/findings/home/desktop//f1');
		expect(buildDeepLink({ reportId: 'example-a', view: 'evidence', targetId: 'home' })).toBe('#r-example-a/evidence/home');
	});
	it('writes the mode for screenshot only', () => {
		expect(buildDeepLink({ reportId: 'example-a', view: 'evidence', targetId: 'home', artifact: 'html', mode: 'overlay' }))
			.toBe('#r-example-a/evidence/home//html');
	});
	it('refuses a state that cannot form a valid link', () => {
		for (const state of [
			{ reportId: '../x' },
			{ reportId: 'example-a', view: 'compare' },
			{ reportId: 'example-a', view: 'evidence', artifact: 'video' },
			{ reportId: 'example-a', view: 'evidence', artifact: 'screenshot', mode: 'blink' },
			{ reportId: 'example-a', view: 'evidence', targetId: 7 },
			{ reportId: 'example-a', view: 'evidence', targetId: '' },
			{ reportId: 'example-a', view: 'evidence', targetId: 'https://example.invalid' },
			{ reportId: 'example-a', view: 'findings', findingId: '//example.invalid' },
			{ reportId: 'example-a', view: 'evidence', targetId: '\ud800' },
			{ reportId: 'example-a', view: 'findings', findingId: 'x\udfff' },
			null,
		]) expect(buildDeepLink(state)).toBeNull();
	});
	it('drops the report part next to an adjacent report.json', () => {
		expect(buildDeepLink({ view: 'evidence', targetId: 'home' }, { adjacent: true })).toBe('#evidence/home');
		expect(buildDeepLink({}, { adjacent: true })).toBe('');
		expect(buildDeepLink({ reportId: 'example-a' }, null)).toBe('#r-example-a');
		expect(parseDeepLink('#r-example-a', null)).toEqual(base);
	});
	it('round-trips through parse', () => {
		const states = [
			link({}),
			link({ view: 'info' }),
			link({ view: 'evidence', targetId: '@project', viewportId: 'mobile', artifact: 'screenshot', findingId: 'a b/c', mode: 'difference' }),
			link({ view: 'findings', targetId: 'home', findingId: 'f1' }),
			link({ view: 'evidence', targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse' }),
		];
		for (const state of states) expect(parseDeepLink(buildDeepLink(state))).toEqual(state);
		const adjacent = link({ reportId: null, view: 'evidence', targetId: 'home', artifact: 'content' });
		expect(parseDeepLink(buildDeepLink(adjacent, { adjacent: true }), { adjacent: true })).toEqual(adjacent);
	});
});
