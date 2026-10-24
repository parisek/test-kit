import { describe, expect, it } from 'vitest';
import { useViewer } from './useViewer.js';
import { resolveDeepLink, parseDeepLink } from './deep-link.js';
import { WORST_FIRST, worstTarget } from '../../../src/report/classify.js';

// One target for each class. The ids say the class; order is the list order.
const row = (state = 'complete') => ({ id: 'wide', state, artifacts: { screenshot: { state } } });
const target = (id, extra = {}) => ({ id, viewports: [row(extra.state)], ...extra.target });
function report(entries, findings = []) {
	return {
		schemaVersion: 2,
		meta: { viewports: [{ id: 'wide' }], matchBelow: 3, noiseFloor: null },
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a' }, { id: 'b' }],
		entries,
		findings,
		causes: [{ id: 'known', known: true }],
		rules: {},
	};
}
const finding = (targetId, causeId) => ({ id: 'f-' + targetId, targetId, viewportId: 'wide', artifact: 'screenshot', causeId });
const mixed = () => report(
	[
		target('m1'),
		target('un1', { state: 'failed' }),
		target('or1', { target: { judge: 'oracle' } }),
		target('ex1'),
		target('un2'),
		target('x1'),
		target('un3'),
	],
	[finding('or1', 'known'), finding('ex1', 'known'), finding('un2', 'nope'), finding('un3', 'nope')],
);
const viewer = () => useViewer({ base: 'http://localhost:4178/', width: () => 1280 });
const opened = (data) => {
	const instance = viewer();
	instance.dispatch('loaded', { report: data, source: '/report.json' });
	return instance;
};

describe('Evidence default target (#218)', () => {
	it('keeps the class order in one list', () => {
		expect(WORST_FIRST).toEqual(['unexplained', 'explained', 'oracle', 'unclassified', 'match']);
	});
	it('picks the worst class first and the first target inside a class', () => {
		expect(worstTarget(mixed()).id).toBe('un2');
		const noUnexplained = mixed();
		noUnexplained.findings = noUnexplained.findings.filter((item) => item.causeId === 'known');
		expect(worstTarget(noUnexplained).id).toBe('ex1');
		const oracleFirst = report([target('m1'), target('x1', { state: 'failed' }), target('or1', { target: { judge: 'oracle' } })], [finding('or1', 'known')]);
		expect(worstTarget(oracleFirst).id).toBe('or1');
		const unclassifiedBeforeMatch = report([target('m1'), target('x1', { state: 'failed' })]);
		expect(worstTarget(unclassifiedBeforeMatch).id).toBe('x1');
	});
	it('picks the first target of an all-match report and null for no targets', () => {
		expect(worstTarget(report([target('a'), target('b')])).id).toBe('a');
		expect(worstTarget(report([]))).toBeNull();
	});
	it('opens Evidence from Overview on the worst target', () => {
		const instance = opened(mixed());
		expect(instance.state.view).toBe('overview');
		instance.dispatch('view', 'evidence');
		expect(instance.state.view).toBe('evidence');
		expect(instance.state.targetId).toBe('un2');
		expect(instance.state.viewportId).toBe('wide');
	});
	it('opens Evidence on the first target of an all-match report', () => {
		const instance = opened(report([target('a'), target('b')]));
		instance.dispatch('view', 'evidence');
		expect(instance.state.targetId).toBe('a');
	});
	it('picks the worst target that the active filter shows', () => {
		const instance = opened(mixed());
		instance.dispatch('filter', { key: 'classification', value: 'explained' });
		instance.dispatch('view', 'evidence');
		expect(instance.state.targetId).toBe('ex1');
	});
	it('keeps the selection when the active filter shows no target', () => {
		const instance = opened(mixed());
		const before = instance.state.targetId;
		instance.dispatch('filter', { key: 'measurement', value: 'incompatible' });
		instance.dispatch('view', 'evidence');
		expect(instance.state.targetId).toBe(before);
	});
	it('keeps a target that the evidence action named', () => {
		const instance = opened(mixed());
		instance.dispatch('evidence', { targetId: 'm1', viewportId: 'wide' });
		instance.dispatch('view', 'overview');
		instance.dispatch('view', 'evidence');
		expect(instance.state.targetId).toBe('m1');
	});
	it('keeps the selection when a person chose a target', () => {
		const instance = opened(mixed());
		instance.dispatch('target', 'm1');
		instance.dispatch('view', 'overview');
		instance.dispatch('view', 'evidence');
		expect(instance.state.targetId).toBe('m1');
	});
	it('lets a deep link that names a target win', () => {
		const data = mixed();
		const link = resolveDeepLink(parseDeepLink('#evidence/m1', { adjacent: true }), data);
		expect(link.targetId).toBe('m1');
	});
	it('keeps the first target for a deep link without a target (R10.14)', () => {
		const data = mixed();
		const link = resolveDeepLink(parseDeepLink('#evidence', { adjacent: true }), data);
		expect(link.view).toBe('evidence');
		expect(link.targetId).toBe(data.entries[0].id);
	});
});
