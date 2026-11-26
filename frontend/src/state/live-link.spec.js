import { describe, expect, it } from 'vitest';
import { buildLiveHash, frameSource, isLiveHash, measureCommand, parseLiveHash, readLiveIndex, resolveLive, scaleFactor, targetsFor, validRatio } from './live-link.js';

const raw = {
	sides: [{ id: 'local', origin: 'http://127.0.0.1:4101' }, { id: 'production', origin: 'http://127.0.0.1:4102' }, { id: 'staging', origin: 'http://127.0.0.1:4103' }],
	targets: [{ id: 'home', paths: { local: '/', production: '/', staging: '/' } }, { id: 'old', paths: { local: '/old', production: null, staging: '/old' } }],
	viewports: [{ id: 'desktop', width: 1440, height: 900 }, { id: 'phone', width: 390, height: 844 }],
};
const index = readLiveIndex(raw);

describe('the Live hash (R10.14, R10.17 item 5)', () => {
	it('matches #live, #live/ and #live? only', () => {
		for (const hash of ['#live', '#live/', '#live?layout=swap', '#live/home/a/b/desktop']) expect(isLiveHash(hash)).toBe(true);
		for (const hash of ['#lively', '#r-live', '', '#overview', 'live']) expect(isLiveHash(hash)).toBe(false);
	});
	it('parses, resolves and builds the same state', () => {
		const state = { targetId: 'old', sideA: 'local', sideB: 'staging', viewportId: 'phone', layout: 'side-by-side', zoom: '75', show: 'b' };
		const hash = buildLiveHash(state);
		expect(hash).toBe('#live/old/local/staging/phone?layout=side-by-side&zoom=75&show=b');
		expect(resolveLive(parseLiveHash(hash), index)).toEqual({ ...state, notice: null });
	});
	it('fills an omitted part with the first valid value; side B is the first side that is not A', () => {
		expect(resolveLive(parseLiveHash('#live'), index)).toEqual({ targetId: 'home', sideA: 'local', sideB: 'production', viewportId: 'desktop', layout: 'swap', zoom: 'fit', show: 'a', notice: null });
		expect(resolveLive(parseLiveHash('#live//production'), index).sideB).toBe('local');
	});
	it('replaces an unknown part and says so, without repeating the link', () => {
		const resolved = resolveLive(parseLiveHash('#live/<script>/local/nope/desktop?layout=grid&extra=1'), index);
		expect(resolved).toMatchObject({ targetId: 'home', sideA: 'local', sideB: 'production', layout: 'swap' });
		expect(resolved.notice).toMatch(/unknown part/);
		expect(resolved.notice).not.toMatch(/script|nope|grid/);
	});
	it('offers only targets with a path on both sides (R5.19)', () => {
		expect(targetsFor(index, 'local', 'production').map((t) => t.id)).toEqual(['home']);
		expect(resolveLive(parseLiveHash('#live/old/local/production/desktop'), index).targetId).toBe('home');
	});
	it('never builds a hash from an id that is not valid', () => {
		expect(buildLiveHash({ targetId: 'a/b', sideA: 'x', sideB: 'y', viewportId: 'd', layout: 'swap', zoom: 'fit', show: 'a' })).toBe('#live');
		expect(buildLiveHash({ targetId: 'https://evil.example', sideA: 'x', sideB: 'y', viewportId: 'd', layout: 'swap', zoom: 'fit', show: 'a' })).toBe('#live');
	});
});

describe('/live.json is untrusted (R10.17 items 1 and 4)', () => {
	it('keeps only loopback proxy origins, valid ids, valid paths and sizes', () => {
		const read = readLiveIndex({
			sides: [...raw.sides, { id: 'evil', origin: 'https://evil.example' }, { id: 'bad id', origin: 'http://127.0.0.1:1' }, { id: 'port', origin: 'http://127.0.0.1:99999' }, { id: 'path', origin: 'http://127.0.0.1:5/x' }],
			targets: [...raw.targets, { id: 'x', paths: { local: '//evil.example/', production: 'javascript:alert(1)', staging: '/ok' } }],
			viewports: [...raw.viewports, { id: 'huge', width: 1e9, height: 1 }, { id: 'neg', width: -1, height: 5 }],
		});
		expect(read.sides.map((s) => s.id)).toEqual(['local', 'production', 'staging']);
		expect(read.targets.find((t) => t.id === 'x').paths).toEqual({ local: null, production: null, staging: '/ok' });
		expect(read.viewports.map((v) => v.id)).toEqual(['desktop', 'phone']);
	});
	it('drops a side on the viewer origin and sides that share one origin (R10.18 item 2)', () => {
		const [a, b, c] = raw.sides;
		const read = readLiveIndex({ sides: [a, b, c, { id: 'twin', origin: b.origin }], targets: raw.targets, viewports: raw.viewports }, { viewerOrigin: a.origin });
		expect(read.sides.map((s) => s.id)).toEqual([c.id]);
		const same = readLiveIndex({ sides: [a, b, c, { id: c.id, origin: 'http://127.0.0.1:4999' }], targets: raw.targets, viewports: raw.viewports });
		expect(same.sides.map((s) => s.id)).toEqual([a.id, b.id]);
		expect(read.usable).toBe(false);
	});
	it('is not usable with fewer than two sides', () => {
		expect(readLiveIndex({ sides: [raw.sides[0]], targets: raw.targets, viewports: raw.viewports }).usable).toBe(false);
		expect(readLiveIndex(null)).toBe(null);
	});
	it('builds the frame src from the proxy origin and the path only', () => {
		expect(frameSource(index, 'local', 'old')).toBe('http://127.0.0.1:4101/old');
		expect(frameSource(index, 'production', 'old')).toBe(null);
		expect(frameSource(index, 'missing', 'home')).toBe(null);
	});
});

describe('measure, scroll and scale', () => {
	it('copies one command for exactly the shown cell (R10.17 item 8)', () => {
		expect(measureCommand({ targetId: 'home', sideA: 'production', sideB: 'local', viewportId: 'phone' }))
			.toBe('test-kit before --config FILE --side production --target home --viewport phone && test-kit after --config FILE --side local --target home --viewport phone');
		expect(measureCommand({ targetId: 'home; rm -rf /', sideA: 'a', sideB: 'b', viewportId: 'c' })).toBe(null);
	});
	it('accepts a ratio from 0 to 1 only (R10.18 item 6)', () => {
		for (const value of [0, 0.5, 1]) expect(validRatio(value)).toBe(true);
		for (const value of [-0.1, 1.1, NaN, Infinity, '0.5', null]) expect(validRatio(value)).toBe(false);
	});
	it('fits the frame to its pane and never grows it (R10.17 item 3)', () => {
		expect(scaleFactor('fit', 720, 1440)).toBe(0.5);
		expect(scaleFactor('fit', 2000, 1440)).toBe(1);
		expect(scaleFactor('75', 100, 1440)).toBe(0.75);
		expect(scaleFactor('fit', 0, 1440)).toBe(1);
	});
});
