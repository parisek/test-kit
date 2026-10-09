import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonState } from '../../src/compare/runs.js';

test('missing failed and incompatible captures remain distinct', () => {
	const run = { settingsHash: 'same', tools: [{ name: 'playwright', version: '1' }] };
	const shot = { state: 'captured' };
	assert.equal(comparisonState(shot, null, run, run), 'missing');
	assert.equal(comparisonState(shot, { state: 'failed' }, run, run), 'failed');
	assert.equal(comparisonState(shot, shot, run, { ...run, settingsHash: 'other' }), 'incompatible');
	assert.equal(comparisonState(shot, shot, run, { ...run, tools: [{ name: 'playwright', version: '2' }] }), 'incompatible');
	assert.equal(comparisonState(shot, shot, run, run), 'complete');
});
