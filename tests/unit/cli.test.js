import test from 'node:test';
import assert from 'node:assert/strict';
import { run, COMMANDS } from '../../src/cli/run.js';

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

test('a planned command exits with 2 and says it is planned', async () => {
	const err = sink();
	assert.equal(await run(['capture'], { out: sink(), err }), 2);
	assert.match(err.text, /planned and not built yet/);
});
