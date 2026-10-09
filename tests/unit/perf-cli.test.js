import test from 'node:test';
import assert from 'node:assert/strict';
import { planPerfCommand } from '../../src/perf/plan.js';
const config = { sides: { local: { origin: 'http://localhost:8080' }, other: { origin: 'https://localhost:8443' } },
  targets: [{ id: 'home', kind: 'page', path: '/', paths: { local: '/local-home' } }, { id: 'button', kind: 'component', path: '/' }],
  viewports: [{ id: 'desktop', width: 1280, height: 900, deviceScaleFactor: 1 }], artifacts: ['screenshot'], checks: [] };
test('performance CLI plan selects only explicit page IDs and applies side paths', () => {
  const plan = planPerfCommand(config, { side: 'local', targetIds: ['home'] });
  assert.deepEqual(plan.urls, [{ id: 'home', url: 'http://localhost:8080/local-home' }]);
  assert.deepEqual(plan.settingsConfig.artifacts, ['lighthouse']);
  assert.deepEqual(plan.settingsConfig.checks, []);
  assert.equal(plan.viewport.id, 'desktop');
  assert.equal(planPerfCommand(config, { side: 'local', targetIds: ['home'], formFactor: 'mobile' }).viewport.id, 'performance');
  assert.deepEqual(config.artifacts, ['screenshot']);
});
test('performance CLI plan rejects missing, duplicate, unknown, component and HTTPS selections', () => {
  for (const targetIds of [undefined, [], ['home', 'home'], ['unknown'], ['button']]) assert.throws(() => planPerfCommand(config, { side: 'local', targetIds }));
  assert.throws(() => planPerfCommand(config, { side: 'other', targetIds: ['home'] }), /HTTPS/);
  assert.throws(() => planPerfCommand(config, { side: 'missing', targetIds: ['home'] }));
  assert.throws(() => planPerfCommand(config, { side: 'local', targetIds: ['home'], budgets: { lcp_ms: -1 } }));
});
