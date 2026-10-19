import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reads the real workflow file, so the test cannot drift from it (R13.26, R13.44).
const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

const validator = () => {
  const line = workflow.split('\n').find(item => item.includes('const TAG = '));
  assert.ok(line, 'release.yml must define const TAG');
  const literal = line.trim().replace(/^const TAG = /, '').replace(/;$/, '');
  return new RegExp(literal.slice(1, literal.lastIndexOf('/')));
};

// The GitHub filter patterns in use hold only a [0-9] class, "+" (one or more of the previous item) and literal characters.
// A "." is literal in a filter pattern. The whole tag must match.
const triggers = () => [...workflow.matchAll(/^\s+- '(v[^']+)'$/gm)]
  .map(match => new RegExp(`^${match[1].replace(/\./g, '\\.')}$`));
const triggered = tag => triggers().some(pattern => pattern.test(tag));
const accepts = tag => validator().test(tag);

test('the validator accepts stable tags and rc tags', () => {
  for (const tag of ['v0.5.0', 'v1.0.0', 'v10.20.30', 'v1.0.0-rc.1', 'v1.0.0-rc.2', 'v1.0.0-rc.10', 'v0.0.1-rc.99']) assert.equal(accepts(tag), true, tag);
});

test('the validator rejects dev tags and malformed rc tags', () => {
  const bad = ['v1.0.0-dev.1', 'v1.0.0-rc.0', 'v1.0.0-rc.01', 'v1.0.0-rc.', 'v1.0.0-rc', 'v1.0.0-rc.1.1', 'v1.0.0-rc.-1', 'v1.0.0-rc.1a',
    'v1.0.0-RC.1', 'v1.0.0-rc1', 'v1.0-rc.1', 'v01.0.0-rc.1', 'v1.0.0-beta.1', 'v1.0.0-rc.1-dev.1', '1.0.0-rc.1', 'v1.0.0+rc.1', ' v1.0.0-rc.1'];
  for (const tag of bad) assert.equal(accepts(tag), false, tag);
});

test('the validator keeps the stable rule: no leading zero, no other suffix', () => {
  for (const tag of ['v01.0.0', 'v1.00.0', 'v1.0.00', 'v1.0.0-', 'v1.0', 'v1.0.0.0']) assert.equal(accepts(tag), false, tag);
});

test('the validator compares the base version with package.json', () => {
  assert.match(workflow, /match\[1\] !== pkg\.version/);
});

test('the trigger starts a run for stable and rc tags and not for dev tags', () => {
  assert.equal(triggers().length, 2);
  for (const tag of ['v0.5.0', 'v1.0.0', 'v1.0.0-rc.1', 'v1.0.0-rc.12']) assert.equal(triggered(tag), true, tag);
  for (const tag of ['v1.0.0-dev.1', 'v1.0.0-dev.12', 'v1.0.0-beta.1', 'v1.0.0-rc.', 'v1.0.0-rc']) assert.equal(triggered(tag), false, tag);
});

test('only an rc tag creates a prerelease', () => {
  assert.match(workflow, /case "\$\{RELEASE_TAG\}" in \*-rc\.\*\) flags\+=\(--prerelease\)/);
});
