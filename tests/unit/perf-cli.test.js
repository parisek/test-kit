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
test('performance CLI plan rejects missing, duplicate, unknown and component selections', () => {
  for (const targetIds of [undefined, [], ['home', 'home'], ['unknown'], ['button']]) assert.throws(() => planPerfCommand(config, { side: 'local', targetIds }));
  assert.throws(() => planPerfCommand(config, { side: 'missing', targetIds: ['home'] }));
  assert.throws(() => planPerfCommand(config, { side: 'local', targetIds: ['home'], budgets: { lcp_ms: -1 } }));
});
test('performance CLI plan on a production side waits for consent for one target (R6.5)', () => {
  const production = { ...config, sides: { ...config.sides, local: { origin: 'http://localhost:8080', production: true } } };
  assert.throws(() => planPerfCommand(production, { side: 'local', targetIds: ['home'] }),
    (error) => error.code === 'PERFORMANCE_COST_CONSENT_REQUIRED' && /production side/.test(error.message) && /4 navigations \(3 measured\)/.test(error.message));
  assert.equal(planPerfCommand(production, { side: 'local', targetIds: ['home'], consent: true }).cost.navigations, 4);
  // The side id alone does not mark production.
  const named = { ...config, sides: { production: { origin: 'http://localhost:8080' } } };
  assert.equal(planPerfCommand(named, { side: 'production', targetIds: ['home'] }).cost.targets, 1);
});
test('performance CLI plan accepts a local HTTPS side (R6.16, #383)', () => {
  const plan = planPerfCommand(config, { side: 'other', targetIds: ['home'] });
  assert.deepEqual(plan.urls, [{ id: 'home', url: 'https://localhost:8443/' }]);
  assert.deepEqual(plan.network, { origin: 'https://localhost:8443', remote: false, allowOrigins: [], blockPaths: [] });
  assert.deepEqual(plan.settings.networkPolicy, { version: 'host-allowlist-v1' });
});
test('performance CLI plan measures a remote side; production waits for consent (R3.3, R6.5, #383)', () => {
  const side = { origin: 'https://example.com', remote: true, userAgent: 'example-agent/1.0', challenge: 'cloudflare',
    allowOrigins: [{ origin: 'https://fonts.example.net', types: ['font'] }], perfBlockPaths: ['/analytics/*'] };
  const remote = { ...config, sides: { live: side } };
  const plan = planPerfCommand(remote, { side: 'live', targetIds: ['home'] });
  assert.deepEqual(plan.network, { origin: 'https://example.com', remote: true, allowOrigins: ['https://fonts.example.net'],
    blockPaths: ['/analytics/*'], userAgent: 'example-agent/1.0', challenge: 'cloudflare' });
  // R6.9: the policy enters the settings; the User-Agent does not (R3.4).
  assert.deepEqual(plan.settings.networkPolicy, { version: 'host-allowlist-v1', allowOrigins: ['https://fonts.example.net'], blockPaths: ['/analytics/*'] });
  assert.doesNotMatch(JSON.stringify(plan.settings), /example-agent/);
  const production = { ...config, sides: { live: { ...side, production: true } } };
  assert.throws(() => planPerfCommand(production, { side: 'live', targetIds: ['home'] }), (error) => error.code === 'PERFORMANCE_COST_CONSENT_REQUIRED');
  assert.equal(planPerfCommand(production, { side: 'live', targetIds: ['home'], consent: true }).cost.targets, 1);
});

test('performance fails for a target with a null path on its side (R5.19, #414)', () => {
  const skipped = { ...config, targets: [{ id: 'home', kind: 'page', path: '/', paths: { other: null } }] };
  assert.throws(() => planPerfCommand(skipped, { side: 'other', targetIds: ['home'] }), /does not run on side other/);
  assert.equal(planPerfCommand(skipped, { side: 'local', targetIds: ['home'] }).urls[0].url, 'http://localhost:8080/');
});
