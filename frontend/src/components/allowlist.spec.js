import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { adaptReport } from '../../../src/report/model.js';
import { allowedCommand, decisionActions } from '../state/decision.js';
import CheckAudit from './CheckAudit.vue';
import FindingCards from './FindingCards.vue';

// Owner decision on #331 (2026-11-06): allowlist entries in the Checks list, and a copy of the record-allowed command.
const HASH = (char) => `sha256:${char.repeat(64)}`;
const evidence = (src) => ({ src, tool: 'example', version: '1', settingsHash: 'sha256:x' });
const source = 'http://localhost/report.json';
function report(allowlist) {
	return adaptReport({
		schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop', width: 1280, height: 800 }] },
		runs: [{ id: 'run-1', side: 'test', label: 'Checked run' }], subject: { kind: 'single-run', runId: 'run-1' },
		checks: { 'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' }, 'a11y-contrast': { basis: 'absolute', layer: 'package', title: 'Contrast' } },
		entries: [
			{ id: 'button', kind: 'component', title: 'Button', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: { state: 'complete', scope: { checks: ['a11y-axe', 'a11y-contrast'] }, evidence: evidence('runs/run-1/a11y.json'), result: { violations: true, checks: 2 } } } }], artifacts: {} },
			{ id: 'card', kind: 'component', title: 'Card', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: { state: 'complete', scope: { checks: ['a11y-axe'] }, evidence: evidence('runs/run-1/a11y2.json'), result: { violations: false, checks: 1 } } } }], artifacts: {} },
		],
		causes: [], rules: {},
		findings: [
			{ id: 'f1', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-axe', runId: 'run-1', layer: 'package', severity: 'error', message: 'Insufficient color contrast.', evidenceFingerprint: HASH('a') },
			{ id: 'f2', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-contrast', runId: 'run-1', layer: 'package', severity: 'error', message: 'Low contrast.', evidenceFingerprint: HASH('b') },
		],
		...(allowlist ? { allowlist } : {}),
	});
}
const entry = (extra = {}) => ({ checkId: 'a11y-axe', targetId: 'button', fingerprint: HASH('a'), reason: 'Known contrast issue.', owner: 'team-a', status: 'active', ...extra });

describe('allowlist entries in the Checks list (R9.12, ADR 0004 section 7)', () => {
	it('lists the entries of the target with reason, owner, expiry, status and a short fingerprint', () => {
		const data = report([entry({ expires: '2027-01-31' }), entry({ checkId: 'a11y-contrast', fingerprint: HASH('c'), status: 'stale', diagnostic: 'No finding has this fingerprint.' }), entry({ targetId: 'card', reason: 'Other target.' })]);
		const wrapper = mount(CheckAudit, { props: { report: data, targetId: 'button', viewportId: 'desktop', kinds: ['a11y'] } });
		const items = wrapper.findAll('[data-testid="allowlist-entry"]');
		expect(items).toHaveLength(2);
		expect(items[0].text()).toContain('Accessibility (axe)');
		expect(items[0].text()).toContain('active');
		expect(items[0].text()).toContain('Reason: Known contrast issue. Owner: team-a. Expires: 2027-01-31.');
		expect(items[0].text()).toContain(HASH('a').slice(0, 19));
		expect(items[0].text()).not.toContain(HASH('a'));
		expect(items[0].find('p[title]').attributes('title')).toBe(HASH('a'));
		expect(items[1].text()).toContain('stale');
		expect(items[1].text()).toContain('No finding has this fingerprint.');
		expect(wrapper.text()).not.toContain('Other target.');
	});
	it('shows nothing new without an entry for the target, and ignores a bad entry', () => {
		// adaptReport refuses a bad entry, so a bad value is set after loading, as a changed file would arrive.
		for (const allowlist of [undefined, [entry({ targetId: 'card' })], [entry({ status: 'ok' }), entry({ reason: '' }), 'x']]) {
			const data = report(); data.allowlist = allowlist;
			const wrapper = mount(CheckAudit, { props: { report: data, targetId: 'button', viewportId: 'desktop', kinds: ['a11y'] } });
			expect(wrapper.find('[data-testid="allowlist"]').exists()).toBe(false);
		}
	});
	it('leaves out an entry with a check that is not in the catalog, an unknown target and an active entry for a relative check', () => {
		const data = report();
		// adaptReport refuses a relative check in a subject report, so it is added after loading.
		data.checks['text-difference'] = { basis: 'relative', layer: 'package', title: 'Text difference' };
		data.allowlist = [entry({ checkId: 'not-in-catalog' }), entry({ targetId: 'ghost' }), entry({ checkId: 'text-difference', fingerprint: HASH('c') }), entry({ checkId: 'text-difference', status: 'wrong-basis', fingerprint: HASH('d') })];
		const wrapper = mount(CheckAudit, { props: { report: data, targetId: 'button', viewportId: 'desktop', kinds: ['a11y'] } });
		const items = wrapper.findAll('[data-testid="allowlist-entry"]');
		expect(items).toHaveLength(1);
		expect(items[0].text()).toContain('wrong-basis');
		expect(wrapper.text()).not.toContain('not-in-catalog');
	});
	it('writes entry text as text, never as markup', () => {
		const wrapper = mount(CheckAudit, { props: { report: report([entry({ reason: '<img src=x onerror=alert(1)>', owner: '<b>me</b>' })]), targetId: 'button', viewportId: 'desktop', kinds: ['a11y'] } });
		expect(wrapper.find('[data-testid="allowlist"] img').exists()).toBe(false);
		expect(wrapper.find('[data-testid="allowlist"] b').exists()).toBe(false);
		expect(wrapper.get('[data-testid="allowlist"]').text()).toContain('<img src=x onerror=alert(1)>');
	});
	it('shows the group on a target with an entry even when no check is selected', () => {
		const data = report([entry({ targetId: 'card', checkId: 'a11y-contrast', status: 'unchecked' })]);
		const wrapper = mount(CheckAudit, { props: { report: data, targetId: 'card', viewportId: 'desktop', kinds: [] } });
		expect(wrapper.get('[data-testid="allowlist"]').text()).toContain('unchecked');
	});
});

describe('the record-allowed command for an absolute finding (R5.3, R9.12)', () => {
	const finding = { id: 'f1', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-axe', evidenceFingerprint: HASH('a') };
	it('builds the command with the target, the check and the viewport filled in', () => {
		expect(allowedCommand(finding, { source, page: 'http://localhost/' })).toEqual({ text: 'test-kit record-allowed report.json --config FILE --target button --check a11y-axe --viewport desktop --fingerprint ' + HASH('a') + ' --reason TEXT --owner TEXT', reason: null });
		const noViewport = allowedCommand({ ...finding, targetId: '@project', viewportId: undefined, artifact: 'lint', checkId: 'eslint.no-console' }, { source, page: 'http://localhost/' });
		expect(noViewport.text).toBe('test-kit record-allowed report.json --config FILE --target @project --check eslint.no-console --fingerprint ' + HASH('a') + ' --reason TEXT --owner TEXT');
	});
	it('gives no command, and says why, without a fingerprint or with an unsafe id', () => {
		expect(allowedCommand({ ...finding, evidenceFingerprint: undefined }, { source })).toMatchObject({ text: null, reason: expect.stringMatching(/no evidence fingerprint.*config/) });
		expect(allowedCommand({ ...finding, evidenceFingerprint: 'sha256:abc' }, { source }).text).toBeNull();
		for (const bad of [{ targetId: 'a b; rm -rf' }, { checkId: '$(x)' }, { viewportId: 'a;b' }]) expect(allowedCommand({ ...finding, ...bad }, { source }).text).toBeNull();
	});
	it('adds a fifth action to an unexplained absolute finding only', () => {
		const ids = (options) => decisionActions(finding, { source, ...options }).map((action) => action.id);
		expect(ids({ basis: 'absolute' })).toEqual(['fix', 'known', 'allowed', 'noise', 'pass']);
		expect(ids({ basis: 'absolute', explained: true })).toEqual(['fix', 'known', 'noise', 'pass']);
		expect(ids({ basis: 'relative' })).toEqual(['fix', 'known', 'noise', 'pass']);
		expect(ids({})).toEqual(['fix', 'known', 'noise', 'pass']);
	});
});

describe('the Allowlist entry action on a finding card', () => {
	const mountCards = (data, findings) => mount(FindingCards, { props: { source, report: data, findings }, global: { provide: { reportId: computed(() => null) } } });
	it('shows the command and copies it', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const data = report();
		const wrapper = mountCards(data, [data.findings[0]]);
		const group = wrapper.get('[role=group]');
		expect(group.findAll('li').map((item) => item.find('span').text())).toEqual(['Fix', 'Known difference', 'Allowlist entry', 'Noise or unstable', 'Pass on']);
		expect(group.text()).toContain('record-allowed');
		expect(group.text()).toContain(`--target button --check a11y-axe --viewport desktop --fingerprint ${HASH('a')} --reason TEXT --owner TEXT`);
		await group.findAll('button').find((button) => button.attributes('aria-label') === 'Allowlist entry: Copy command').trigger('click');
		await flushPromises();
		expect(writeText).toHaveBeenCalledWith(expect.stringContaining('test-kit record-allowed'));
		expect(wrapper.text()).toContain('Copied.');
		vi.unstubAllGlobals();
	});
	it('shows no fifth action on an explained finding, and gives two findings of one slot their own text', () => {
		const explained = report([entry()]);
		expect(mountCards(explained, [explained.findings[0]]).get('[role=group]').findAll('li').map((item) => item.find('span').text())).not.toContain('Allowlist entry');
		const twin = report();
		twin.findings.push({ ...twin.findings[0], id: 'f3', evidenceFingerprint: HASH('d') });
		const first = mountCards(twin, [twin.findings[0]]).get('[role=group]').text();
		const second = mountCards(twin, [twin.findings[2]]).get('[role=group]').text();
		expect(first).toContain(`--fingerprint ${HASH('a')} `);
		expect(second).toContain(`--fingerprint ${HASH('d')} `);
		expect(first).not.toContain(HASH('d'));
	});
	it('gives a finding with no fingerprint a reason and no command', () => {
		const data = report();
		delete data.findings[0].evidenceFingerprint;
		const group = mountCards(data, [data.findings[0]]).get('[role=group]');
		expect(group.text()).toContain('no evidence fingerprint');
		expect(group.text()).not.toContain('test-kit record-allowed');
	});
});
