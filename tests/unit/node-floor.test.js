// The Node floor must read the same in package.json, the CI Node 20 job, AGENTS.md and the preflight script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('engines.node equals the floor in ci.yml, AGENTS.md and the preflight script', () => {
  const engines = JSON.parse(read('package.json')).engines.node;
  const match = /^>=(\d+\.\d+)$/.exec(engines);
  assert.ok(match, `engines.node must be ">=MAJOR.MINOR", got ${engines}`);
  const floor = match[1];

  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, new RegExp(`matrix\\.node == '${floor.split('.')[0]}' && '${floor.replace('.', '\\.')}'`));

  const agents = /NODE_REQUIRES: "([^"]+)"/.exec(read('AGENTS.md'));
  assert.equal(agents?.[1], engines);

  assert.ok(read('scripts/development-preflight.mjs').includes(`Node ${floor} or newer`));
});
