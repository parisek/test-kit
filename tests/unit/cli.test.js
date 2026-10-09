import test from 'node:test';
import assert from 'node:assert/strict';
import { run, COMMANDS, parseCommand } from '../../src/cli/run.js';

const sink = () => { let text = ''; return { write: (chunk) => { text += chunk; }, get text() { return text; } }; };

test('help lists every command', async () => {
	const out = sink();
	assert.equal(await run(['--help'], { out, err: sink() }), 0);
	for (const name of Object.keys(COMMANDS)) assert.match(out.text, new RegExp(`\\b${name}\\b`));
});

test('no argument prints the help', async () => {
	const out = sink();
	assert.equal(await run([], { out, err: sink() }), 0);
	assert.match(out.text, /Usage: test-kit/);
});

test('version prints the version', async () => {
	const out = sink();
	assert.equal(await run(['--version'], { out, err: sink() }, '1.2.3'), 0);
	assert.equal(out.text, '1.2.3\n');
});

test('an unknown command is a usage error', async () => {
	const err = sink();
	assert.equal(await run(['nope'], { out: sink(), err }), 1);
	assert.match(err.text, /Unknown command: nope/);
});

test('capture without a side fails before dispatch', async () => {
	const err = sink();
	assert.equal(await run(['capture'], { out: sink(), err }), 1);
	assert.match(err.text, /requires --side/);
});

test('strict flags reject duplicates, unsupported flags and numeric errors', () => {
  for (const args of [['serve', 'report', '--port', 'NaN'], ['serve', 'report', '--port', '65536'], ['summary', 'report', '--max-targets', '0'], ['capture', '--side', 'local', '--side', 'other'], ['capture', '--side'], ['capture', '--side', 'local', '--unknown', 'value'], ['diff', 'a', 'b'], ['summary', 'report', 'extra']]) assert.throws(() => parseCommand(args));
});

test('command parsing keeps explicit configuration and scoped queries', () => {
  assert.equal(parseCommand(['capture', '--side', 'local', '--label', 'Before']).options.label, 'Before');
  assert.equal(parseCommand(['summary', 'report.json', '--max-targets', '3', '--filter', 'unexplained']).options.maxTargets, 3);
  assert.equal(parseCommand(['serve', 'report.json', '--port', '0']).options.port, 0);
});

test('JSON output preserves an operational failure exit', async () => {
  const out = sink();
  const code = await run(['capture', '--side', 'local'], { out, err: sink() }, '0.1.0', async request => {
    assert.equal(request.options.side, 'local');
    return { output: { state: 'partial' }, exitCode: 1 };
  });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(out.text), { state: 'partial' });
});

test('pixel differences do not change successful command exit codes', async () => {
  assert.equal(await run(['diff', 'a', 'b', '--output', 'report'], { out: sink(), err: sink() }, '0.1.0', async () => ({ output: { ratio: 100 }, exitCode: 0 })), 0);
});

test('dispatch failures become concise operational errors', async () => {
  const err = sink();
  assert.equal(await run(['serve', 'report.json'], { out: sink(), err }, '0.1.0', async () => { throw new Error('Report is missing'); }), 1);
  assert.equal(err.text, 'Report is missing\n');
});
