import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { adaptReport } from '../../../src/report/model.js';
import { summarize, targetClass } from '../../../src/report/classify.js';
import { checksFor, locationText, checkLabel } from '../state/checks-model.js';
import { knownCommand, decisionActions } from '../state/decision.js';
import TargetDetail from './TargetDetail.vue';
import MatrixView from './MatrixView.vue';
import RunSummary from './RunSummary.vue';
import FindingCards from './FindingCards.vue';
import CheckAudit from './CheckAudit.vue';

// A subject report (R9.7) with an accessibility result at viewport scope and a lint result at target scope (R9.9, R9.11).
// The viewer and the summary read it through the same functions (Principle 2, R11.6). Data is example-site only.
const evidence = (src) => ({ src, tool: 'example', version: '1', settingsHash: 'sha256:x' });
function subject() {
	return adaptReport({
		schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop', width: 1280, height: 800 }] },
		runs: [{ id: 'run-1', side: 'test', label: 'Checked run' }], subject: { kind: 'single-run', runId: 'run-1' },
		checks: {
			'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' },
			'eslint-no-console': { basis: 'absolute', layer: 'project', title: 'No console call' },
			'a11y-contrast': { basis: 'absolute', layer: 'package', title: 'Contrast' },
		},
		entries: [
			{ id: 'button', kind: 'component', title: 'Button', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: { state: 'complete', scope: { checks: ['a11y-axe'] }, evidence: evidence('runs/run-1/a11y.json'), result: { violations: true, checks: 1 } } } }], artifacts: {} },
			{ id: 'card', kind: 'component', title: 'Card', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: { state: 'complete', scope: { checks: ['a11y-contrast'] }, evidence: evidence('runs/run-1/a11y2.json'), result: { violations: false, checks: 1 } } } }], artifacts: {} },
			{ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: { lint: { state: 'complete', scope: { checks: ['eslint-no-console'] }, evidence: evidence('runs/run-1/lint.json'), result: { violations: true, checks: 1 } } } },
		],
		causes: [], rules: {},
		findings: [
			{ id: 'f-axe', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-axe', runId: 'run-1', layer: 'component', severity: 'error', message: 'Insufficient color contrast.', location: { selector: '.example-site-button' } },
			{ id: 'f-lint', targetId: '@project', artifact: 'lint', checkId: 'eslint-no-console', runId: 'run-1', layer: 'project', severity: 'error', message: 'Unexpected console statement.', location: { file: 'src/example-site/header.js', line: 12, column: 3 } },
		],
	});
}

describe('checks list of a target (R8.6, R8.7)', () => {
	it('lists the fired check first and collapses a check that is selected elsewhere', () => {
		const report = subject();
		const model = checksFor(report, report.entries[0], { viewportId: 'desktop', kinds: ['a11y'] });
		expect(model.fired.map((item) => [item.id, item.count, item.label, item.layer])).toEqual([['a11y-axe', 1, 'violation', 'package']]);
		expect(model.other.map((item) => [item.id, item.label])).toEqual([['a11y-contrast', 'not selected on this target']]);
	});
	it('says "no finding" only for a selected check on a complete artifact', () => {
		const report = subject();
		const card = checksFor(report, report.entries[1], { viewportId: 'desktop', kinds: ['a11y'] });
		expect(card.fired).toEqual([]);
		expect(card.other.find((item) => item.id === 'a11y-contrast')).toMatchObject({ label: 'no finding', state: null });
		report.entries[1].viewports[0].artifacts.a11y.state = 'failed';
		const failed = checksFor(report, report.entries[1], { viewportId: 'desktop', kinds: ['a11y'] }).other.find((item) => item.id === 'a11y-contrast');
		expect(failed).toMatchObject({ label: null, state: 'failed' });
	});
	it('does not claim a selection that the report does not record', () => {
		const report = subject();
		delete report.entries[1].viewports[0].artifacts.a11y.scope;
		const model = checksFor(report, report.entries[1], { viewportId: 'desktop', kinds: ['a11y'] });
		expect(model.other.find((item) => item.id === 'a11y-contrast')).toBeUndefined();
	});
	it('shows an override with its reason and owner', () => {
		const report = subject();
		report.overrides = [{ checkId: 'a11y-contrast', scope: { targets: ['card'] }, reason: 'Third-party widget.', owner: 'team-web', layer: 'project' }];
		const item = checksFor(report, report.entries[1], { viewportId: 'desktop', kinds: ['a11y'] }).other.find((entry) => entry.id === 'a11y-contrast');
		expect(item).toMatchObject({ label: 'switched off', state: 'missing', reason: 'Third-party widget.', owner: 'team-web' });
	});
	it('reads locations and catalog labels', () => {
		expect(locationText({ file: 'a.js', line: 3, column: 4 })).toBe('a.js:3:4');
		expect(locationText({ file: 'a.js' })).toBe('a.js');
		expect(locationText({ selector: '.x' })).toBe('.x');
		expect(locationText('x')).toBe('');
		const report = subject();
		expect(checkLabel(report, report.findings[1])).toEqual({ id: 'eslint-no-console', title: 'No console call', layer: 'project', basis: 'absolute' });
		expect(checkLabel(report, { artifact: 'screenshot' })).toBeNull();
	});
});

describe('a subject report in the viewer', () => {
	it('classifies with the same functions as the summary', () => {
		const report = subject();
		expect(report.entries.map((entry) => targetClass(report, entry))).toEqual(['unexplained', 'match', 'unexplained']);
		expect(summarize(report).counts).toMatchObject({ unexplained: 2, match: 1, unclassified: 0, incomplete: 0, total: 3 });
	});
	it('shows the run card without sides A and B and without a viewport warning for the project entry', () => {
		const wrapper = mount(RunSummary, { props: { report: subject(), summary: summarize(subject()) } });
		expect(wrapper.text()).toContain('Checked run');
		expect(wrapper.text()).not.toContain('Baseline');
		expect(wrapper.text()).not.toContain('Absent declared viewport');
		expect(wrapper.text()).not.toContain('Availability problems');
	});
	it('shows the project entry as one cell with no availability badge', () => {
		const wrapper = mount(MatrixView, { props: { report: subject() } });
		expect(wrapper.text()).toContain('Open project evidence');
		expect(wrapper.text()).not.toContain('Availability not measured');
		expect(wrapper.text()).toContain('Screenshot not requested');
	});
	it('shows the lint result and its finding on the project entry, which has no row', () => {
		const report = subject();
		const wrapper = mount(TargetDetail, { props: { report, targetId: '@project', viewportId: 'desktop' } });
		expect(wrapper.text()).toContain('Lint');
		expect(wrapper.text()).toContain('1 check executed');
		expect(wrapper.text()).toContain('No console call');
		expect(wrapper.text()).toContain('src/example-site/header.js:12:3');
		expect(wrapper.text()).not.toContain('Missing evidence');
		expect(wrapper.text()).not.toContain('Viewport');
		expect(wrapper.text()).toContain('unexplained');
	});
	it('shows an accessibility result on a viewport row with no evidence type tab', () => {
		const report = subject();
		const wrapper = mount(TargetDetail, { props: { report, targetId: 'button', viewportId: 'desktop' } });
		expect(wrapper.text()).toContain('Accessibility');
		expect(wrapper.text()).toContain('.example-site-button');
		expect(wrapper.text()).not.toContain('No evidence is indexed');
		expect(wrapper.text()).not.toContain('A: unknown');
		expect(wrapper.find('nav.evidence-artifacts').exists()).toBe(false);
	});
	it('never lists a failed absolute artifact as a pass', () => {
		const report = subject();
		report.entries[2].artifacts.lint = { state: 'failed', diagnostic: 'The linter exited with an error.' };
		const wrapper = mount(CheckAudit, { props: { report, targetId: '@project', kinds: ['lint'] } });
		expect(wrapper.text()).toContain('failed');
		expect(wrapper.text()).toContain('The linter exited with an error.');
		expect(wrapper.text()).not.toContain('no violation found');
	});
});

describe('decision actions for an absolute finding (R7.3)', () => {
	const finding = { id: 'f', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'heading-outline' };
	it('offers no known-difference command for an absolute finding', () => {
		expect(knownCommand(finding, { basis: 'absolute' })).toBeNull();
		expect(knownCommand(finding, { basis: 'relative' })).toContain('record-known');
		const known = decisionActions(finding, { basis: 'absolute' }).find((action) => action.id === 'known');
		expect(known.text).toBeNull();
		expect(known.reason).toMatch(/relative check only/);
	});
	it('labels the check and the location on a finding card', () => {
		const report = subject();
		const wrapper = mount(FindingCards, { props: { findings: report.findings, report, source: 'http://localhost/report.json' } });
		expect(wrapper.text()).toContain('Accessibility (axe) (a11y-axe, component layer)');
		expect(wrapper.text()).toContain('Target');
		expect(wrapper.text()).toContain('unexplained');
	});
});

describe('a pair report with absolute content findings (R9.10)', () => {
	it('lists the absolute check next to the relative evidence, and the finding is unexplained', () => {
		const side = (src) => ({ ...evidence(src) });
		const report = adaptReport({
			schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
			checks: { 'heading-outline': { basis: 'absolute', layer: 'package', title: 'Heading outline' }, 'text-difference': { basis: 'relative', layer: 'package', title: 'Stored text difference' } },
			entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'desktop', state: 'complete', artifacts: { content: { state: 'complete', scope: { checks: ['heading-outline', 'text-difference'] }, a: side('a.json'), b: side('b.json'), diff: { ...side('d.json'), changed: true, checks: 2 } } } }], artifacts: {} }],
			causes: [], rules: {}, findings: [{ id: 'f', targetId: 'home', viewportId: 'desktop', artifact: 'content', checkId: 'heading-outline', runId: 'b', layer: 'package', severity: 'warning', message: 'The page must have one h1 heading.' }],
		});
		const wrapper = mount(TargetDetail, { props: { report, targetId: 'home', viewportId: 'desktop', artifact: 'content' } });
		expect(wrapper.text()).toContain('Heading outline');
		expect(wrapper.text()).toContain('1 fired');
		expect(wrapper.text()).not.toContain('Stored text difference');
		expect(targetClass(report, report.entries[0])).toBe('unexplained');
	});
});
