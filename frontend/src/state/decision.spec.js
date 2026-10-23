import { describe, expect, it } from 'vitest';
import { decisionActions, findingLink, knownCommand, recaptureCommand, reportArgument } from './decision.js';

const finding = { id: 'f1', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot' };

describe('decision actions (viewer-workflow "Decision actions")', () => {
	it('offers the four actions in workflow order', () => {
		expect(decisionActions(finding, { reportId: 'example-a', page: 'http://127.0.0.1/' }).map((action) => action.label))
			.toEqual(['Fix', 'Known difference', 'Noise or unstable', 'Pass on']);
	});
	it('links the finding in the Evidence view', () => {
		expect(findingLink(finding, { reportId: 'example-a', page: 'http://127.0.0.1/index.html#r-old' }))
			.toBe('http://127.0.0.1/index.html#r-example-a/evidence/home/desktop/screenshot/f1');
		expect(findingLink(finding, { page: 'http://127.0.0.1/' })).toBe('http://127.0.0.1/#evidence/home/desktop/screenshot/f1');
	});
	it('leaves the artifact segment empty for a finding outside the evidence types', () => {
		expect(findingLink({ ...finding, artifact: 'a11y' }, { reportId: 'example-a', page: '' })).toBe('#r-example-a/evidence/home/desktop//f1');
	});
	it('fills the known-difference command and keeps config, cause and reason as placeholders', () => {
		expect(knownCommand(finding, { source: 'http://127.0.0.1/pub/reports/example-a/report.json', page: 'http://127.0.0.1/pub/index.html#r-example-a' }))
			.toBe('test-kit record-known reports/example-a/report.json --config FILE --target home --viewport desktop --artifact screenshot --cause ID --reason TEXT');
	});
	it('uses REPORT when the loaded path is not a plain relative path', () => {
		const page = 'http://127.0.0.1/pub/';
		for (const source of ['/abs/report.json', '../report.json', 'http://example.test/pub/report.json', 'a%20b.json', null]) expect(reportArgument(source, page)).toBe('REPORT');
		expect(reportArgument('http://127.0.0.1/pub/report.json?x=1', page)).toBe('report.json');
		expect(reportArgument('report.json', '')).toBe('REPORT');
	});
	it('offers no known-difference command for an artifact that record-known does not take', () => {
		for (const artifact of ['status', 'behavior', 'lighthouse', 'a11y']) expect(knownCommand({ ...finding, artifact })).toBeNull();
		const action = decisionActions({ ...finding, artifact: 'status' }, { reportId: 'example-a' })[1];
		expect(action.text).toBeNull();
		expect(action.reason).toMatch(/screenshot, HTML or content/);
	});
	it('never puts an unsafe id into a command', () => {
		for (const targetId of ['home; rm -rf ~', '$(id)', 'a b', '`x`', "it's", '-rf', '']) {
			expect(knownCommand({ ...finding, targetId })).toBeNull();
			expect(recaptureCommand({ ...finding, targetId })).toBeNull();
		}
		expect(recaptureCommand({ ...finding, viewportId: null })).toBeNull();
		expect(recaptureCommand({ ...finding, targetId: '@project' })).toBe('test-kit run --config FILE --target @project --viewport desktop');
	});
	it('gives the reason when a finding cannot form a link', () => {
		const [fix, , , pass] = decisionActions({ ...finding, id: 'https://other.example/x' }, { reportId: 'example-a' });
		expect(fix.text).toBeNull();
		expect(pass.reason).toBe('This finding has no valid link.');
	});
});
