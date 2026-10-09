import assert from 'node:assert/strict';
import { startExampleSite } from './example-site-server.mjs';

const baseline = await startExampleSite();
const changed = await startExampleSite({ variant: 'changed' });
try {
  const body = async (site, path) => (await fetch(site.origin + path)).text();
  assert.equal(await body(baseline, '/unchanged'), await body(changed, '/unchanged'));
  assert.notEqual(await body(baseline, '/changed'), await body(changed, '/changed'));
  const redirect = await fetch(baseline.origin + '/redirect', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/unchanged');
  assert.equal((await fetch(baseline.origin + '/status/500')).status, 500);
  assert.equal((await fetch(baseline.origin + '/missing')).status, 404);
  assert.equal((await fetch(baseline.origin + '/constructor')).status, 404);
  assert.match(await body(baseline, '/delayed-asset'), /src="\/asset.svg"/);
  assert.match(await body(baseline, '/asset.svg'), /<svg/);
  assert.match(await body(baseline, '/motion'), /class="motion"/);
  assert.match(await body(baseline, '/site.css'), /prefers-reduced-motion: reduce/);
  console.log('Example site route checks pass.');
} finally {
  await Promise.all([baseline.close(), changed.close()]);
}
