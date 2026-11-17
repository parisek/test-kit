// The process tools of docs/process.md (review records, decision requests, the Codex gate) keep their contract.
// scripts/process/test.sh runs them with fake gh and codex binaries. No network, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/process/test.sh', import.meta.url));
const has = (tool) => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0;
const missing = ['bash', 'git', 'jq'].filter((tool) => !has(tool));

test('scripts/process/test.sh passes', { skip: missing.length ? `needs ${missing.join(', ')}` : false }, () => {
	const run = spawnSync('bash', [script], { encoding: 'utf8', timeout: 120000 });
	assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
