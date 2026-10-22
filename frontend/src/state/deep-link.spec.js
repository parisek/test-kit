import { describe, expect, it } from 'vitest';
import { buildDeepLink, modeFromState, modeToState, parseDeepLink, resolveDeepLink } from './deep-link.js';

const base = { reportId: 'example-a', view: 'overview', targetId: null, viewportId: null, artifact: null, findingId: null, mode: null, notice: null };
const link = (extra) => ({ ...base, ...extra });
// A notice comes from a closed set and never repeats text from the link.
const NOTICES = [
	'The link names no valid report.',
	'A part of the link cannot be read.',
	'The link holds a URL. A link part must be an id.',
	'The link names an unknown view.',
	'The link has too many parts.',
	'The link names an unknown evidence type.',
	'The link names an unknown mode.',
	'The link names a finding that this report does not hold.',
	'The link names a target that this report does not hold.',
	'The link names a viewport that this report does not hold.',
	'The link names an evidence type that this page does not have.',
	'The link and its finding name different parts. The finding wins.',
];
const notice = { asymmetricMatch: (value) => NOTICES.includes(value), toAsymmetricMatcher: () => 'a known notice' };

describe('deep link parse (R10.14)', () => {
	it('reads a full link and decodes each part', () => {
		expect(parseDeepLink('#r-example-a/evidence/%40project/desktop/screenshot/f%3F1%20x?mode=overlay')).toEqual(link({
			view: 'evidence', targetId: '@project', viewportId: 'desktop', artifact: 'screenshot', findingId: 'f?1 x', mode: 'overlay',
		}));
	});
	it('keeps the plain report link valid and opens the Overview', () => {
		expect(parseDeepLink('#r-example-a')).toEqual(base);
		expect(parseDeepLink('#r-example-a/')).toEqual(base);
	});
	it('ignores the target, viewport, artifact, finding and mode parts on overview and info', () => {
		expect(parseDeepLink('#r-example-a/info/home/desktop/html/f1?mode=overlay')).toEqual(link({ view: 'info' }));
		expect(parseDeepLink('#r-example-a/overview/home')).toEqual(base);
		expect(parseDeepLink('#r-example-a/info/a/b/c/d/e/f')).toEqual(link({ view: 'info' }));
		// A part that fails to decode shows a notice, also where the view ignores it.
		expect(parseDeepLink('#r-example-a/info/%E0%A4%A').notice).toEqual(notice);
		expect(parseDeepLink('#r-example-a/info?x=%E0').notice).toEqual(notice);
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
	it('refuses any id with a colon, slash or backslash, because every URL needs one', () => {
		for (const hash of [
			'#r-example-a/evidence/ssh%3Ax',
			'#r-example-a/evidence/gopher%3Aselector',
			'#r-example-a/evidence/urn%3Aisbn%3A9780141036144',
			'#r-example-a/findings/home/desktop/content/content-home-desktop-a11y%3Acontrast-0',
			'#r-example-a/evidence/a%2Fb',
		]) expect(parseDeepLink(hash).notice).toEqual(notice);
		expect(buildDeepLink({ reportId: 'example-a', view: 'findings', findingId: 'check:x' })).toBeNull();
		expect(buildDeepLink({ reportId: 'example-a', view: 'evidence', targetId: 'a/b' })).toBeNull();
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
			expect(result.notice).toEqual(notice);
		}
	});
	it('opens the Home with a notice for an invalid report id', () => {
		for (const hash of ['#r-', '#r-../x', '#r-a%20b', '#r-%3Cx%3E', '#r-%E0%A4%A']) {
			const result = parseDeepLink(hash);
			expect(result.reportId).toBeNull();
			expect(result.notice).toEqual(notice);
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
			'#r-example-a/info/%E0javascript%3A1',
			'#r-example-a/overview/%E0javascript%3Ax',
			'#r-example-a/evidence/home?x=%E0javascript%3A1',
		]) {
			const result = parseDeepLink(hash);
			expect(result).toMatchObject({ reportId: 'example-a', view: 'overview', targetId: null, findingId: null });
			expect(result.notice).toEqual(notice);
		}
	});
	it('drops the report part next to an adjacent report.json', () => {
		expect(parseDeepLink('#evidence/home/desktop/status', { adjacent: true })).toEqual(link({
			reportId: null, view: 'evidence', targetId: 'home', viewportId: 'desktop', artifact: 'status',
		}));
		expect(parseDeepLink('#r-example-a', { adjacent: true }).notice).toEqual(notice);
	});
});

describe('deep link build (R10.14)', () => {
	it('treats an empty mode as no mode, as the parse does', () => {
		expect(buildDeepLink({ reportId: 'example-a', view: 'evidence', targetId: 'home', artifact: 'screenshot', mode: '' })).toBe('#r-example-a/evidence/home//screenshot');
		expect(parseDeepLink('#r-example-a/evidence/home//screenshot?mode=').mode).toBeNull();
	});
	it('builds the plain report link for the Overview', () => {
		expect(buildDeepLink({ reportId: 'example-a' })).toBe('#r-example-a');
		expect(buildDeepLink({ reportId: 'example-a', view: 'overview', targetId: 'home' })).toBe('#r-example-a');
		expect(buildDeepLink({ reportId: 'example-a', view: 'info' })).toBe('#r-example-a/info');
	});
	it('encodes each part, keeps empty middle parts and omits trailing ones', () => {
		expect(buildDeepLink({
			reportId: 'example-a', view: 'evidence', targetId: '@project', viewportId: 'desktop', artifact: 'screenshot', findingId: 'f?1#x', mode: 'overlay',
		})).toBe('#r-example-a/evidence/%40project/desktop/screenshot/f%3F1%23x?mode=overlay');
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
			link({ view: 'evidence', targetId: '@project', viewportId: 'mobile', artifact: 'screenshot', findingId: 'a b?c', mode: 'difference' }),
			link({ view: 'findings', targetId: 'home', findingId: 'f1' }),
			link({ view: 'evidence', targetId: 'home', viewportId: 'desktop', artifact: 'lighthouse' }),
			link({ view: 'evidence', targetId: 'home', viewportId: 'desktop', artifact: 'behavior' }),
		];
		for (const state of states) expect(parseDeepLink(buildDeepLink(state))).toEqual(state);
		const adjacent = link({ reportId: null, view: 'evidence', targetId: 'home', artifact: 'content' });
		expect(parseDeepLink(buildDeepLink(adjacent, { adjacent: true }), { adjacent: true })).toEqual(adjacent);
	});
});

describe('deep link against the open report (R10.14)', () => {
	const report = {
		meta: { viewports: [{ id: 'desktop' }, { id: 'mobile' }] },
		entries: [
			{ id: 'home', viewports: [{ id: 'desktop', artifacts: { screenshot: {}, html: {} } }, { id: 'mobile', artifacts: { screenshot: {} } }] },
			{ id: '@project', viewports: [{ id: 'desktop', artifacts: { status: {} } }] },
		],
		findings: [
			{ id: 'f1', targetId: 'home', viewportId: 'mobile', artifact: 'screenshot' },
			{ id: 'f1', targetId: '@project', viewportId: 'desktop', artifact: 'status' },
			{ id: 'b1', targetId: 'home', viewportId: 'desktop', artifact: 'a11y' },
		],
	};
	const resolve = (hash) => resolveDeepLink(parseDeepLink(hash), report);
	it('accepts ids that the report holds, the reserved @project included', () => {
		expect(resolve('#r-example-a/evidence/%40project/desktop/status')).toMatchObject({ view: 'evidence', targetId: '@project', viewportId: 'desktop', artifact: 'status', notice: null });
	});
	it('takes the first valid value for an omitted part', () => {
		expect(resolve('#r-example-a/evidence')).toMatchObject({ view: 'evidence', targetId: 'home', viewportId: null, artifact: null, notice: null });
	});
	it('opens the Overview with a notice for an id that the report does not hold', () => {
		for (const hash of ['#r-example-a/evidence/away', '#r-example-a/evidence/home/tablet', '#r-example-a/evidence/home/mobile/html', '#r-example-a/findings////f9']) {
			const result = resolve(hash);
			expect(result.view).toBe('overview');
			expect(result.notice).toEqual(notice);
		}
	});
	it('selects the first finding with the id, which wins over the other parts', () => {
		expect(resolve('#r-example-a/findings////f1')).toMatchObject({ view: 'findings', targetId: 'home', viewportId: 'mobile', artifact: 'screenshot', findingId: 'f1', notice: null });
		const differs = resolve('#r-example-a/evidence/%40project/desktop/status/f1');
		expect(differs).toMatchObject({ targetId: 'home', viewportId: 'mobile', artifact: 'screenshot' });
		expect(differs.notice).toEqual(notice);
	});
	it('keeps an empty evidence type for a finding whose artifact is not an evidence type', () => {
		expect(resolve('#r-example-a/evidence/home/desktop//b1')).toMatchObject({ targetId: 'home', viewportId: 'desktop', artifact: null, findingId: 'b1', notice: null });
		// The finding wins over an evidence type in the path, with a notice.
		const named = resolve('#r-example-a/evidence/home/desktop/html/b1');
		expect(named).toMatchObject({ artifact: null, findingId: 'b1' });
		expect(named.notice).toEqual(notice);
	});
	it('shows the first valid type when the evidence type of a finding is missing on its row', () => {
		const sparse = { meta: { viewports: [{ id: 'desktop' }] }, entries: [{ id: 'home', viewports: [{ id: 'desktop', artifacts: { html: {} } }] }], findings: [{ id: 'f3', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot' }] };
		expect(resolveDeepLink(parseDeepLink('#r-example-a/evidence/home/desktop/screenshot/f3'), sparse)).toMatchObject({ view: 'evidence', artifact: null, findingId: 'f3', notice: null });
	});
	it('opens Findings for a report with no targets', () => {
		expect(resolveDeepLink(parseDeepLink('#r-example-a/findings'), { meta: { viewports: [] }, entries: [], findings: [] })).toMatchObject({ view: 'findings', notice: null });
	});
	it('keeps the mode only for screenshot', () => {
		expect(resolve('#r-example-a/evidence/home/desktop/screenshot?mode=overlay').mode).toBe('overlay');
		expect(resolve('#r-example-a/evidence/home/desktop/html?mode=overlay').mode).toBeNull();
	});
	it('ignores everything but the view on overview and info, and passes a parse notice on', () => {
		expect(resolve('#r-example-a/info')).toMatchObject({ view: 'info', targetId: null, notice: null });
		expect(resolve('#r-example-a/compare')).toMatchObject({ view: 'overview', notice: notice });
		expect(resolveDeepLink(null, report).view).toBe('overview');
	});
	it('maps the stored comparison mode to the link mode and back', () => {
		expect(modeToState('difference')).toBe('diff');
		expect(modeFromState('diff')).toBe('difference');
		expect(modeFromState('side-by-side')).toBe('side-by-side');
		expect(modeToState('blink')).toBeNull();
	});
});
