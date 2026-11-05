// Explicit browser integration check. npm test does not discover this file.
// A synthetic styleguide (example-site data only) serves a component list and one render page for each component.
// It checks R13.3: one target for each component, a self-baseline pair, a removed component, an unknown component
// and a component with no fixture (skipped, listed, no request).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';

const colors = { button: '#c00', card: '#0a0', banner: '#00c' };
let catalogue = [];
let colorOf = { ...colors };
const requests = [];
const site = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  requests.push(url.pathname);
  const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
  if (url.pathname === '/styleguide/api/components') return send(200, 'application/json', JSON.stringify(catalogue));
  const match = /^\/styleguide\/render\/component\/([a-z-]+)$/.exec(url.pathname);
  if (match && colorOf[match[1]]) return send(200, 'text/html', `<!doctype html><title>${match[1]}</title><style>html,body{margin:0}div{width:160px;height:80px;background:${colorOf[match[1]]}}</style><div></div>`);
  send(404, 'text/plain', 'Not found');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${site.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'test-kit-styleguide-'));
try {
  const configPath = join(directory, 'config.json');
  const config = (extra = {}) => JSON.stringify({ schemaVersion: 1, sides: { styleguide: { origin } },
    targetSource: { source: 'styleguide', side: 'styleguide', ...extra }, viewports: [{ id: 'small', width: 320, height: 240 }, { id: 'wide', width: 640, height: 240 }],
    artifacts: ['screenshot', 'html', 'status'], runsRoot: 'runs' });
  await writeFile(configPath, config());
  const entry = id => ({ id, name: id[0].toUpperCase() + id.slice(1), has_styleguide: true });
  const runsRoot = join(directory, 'runs');

  // Run A: three components with a fixture and one without.
  catalogue = [entry('card'), entry('button'), entry('banner'), { id: 'hero', name: 'Hero', has_styleguide: false }];
  const a = await capture({ configPath, side: 'styleguide' });
  assert.deepEqual(a.run.settings.targets.map(target => target.id), ['banner', 'button', 'card']);
  assert.equal(a.run.captures.length, 6, 'One capture for each component with a fixture and viewport.');
  for (const row of a.run.captures) assert.equal(row.state, 'captured', JSON.stringify(row));
  assert.equal(a.run.state, 'complete', 'A component with no fixture is skipped and does not keep the run partial.');
  assert.deepEqual(a.run.targetSource.noFixture, ['hero']);
  assert.equal(a.run.targetSource.resolved, 3);
  assert.equal(requests.some(url => url.includes('/hero')), false, 'No request goes to the render page of a component with no fixture.');
  assert.equal(a.run.settings.targetSource, undefined, 'The stored settings read as a plain target list.');

  // Run B: same styleguide, so a self-baseline pair has no difference. The fixture-less component is no entry; the report and summary list it.
  const b = await capture({ configPath, side: 'styleguide' });
  const same = await compareRuns({ runsRoot, runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'same'), kind: 'self-baseline' });
  assert.equal(same.report.pair.kind, 'self-baseline');
  const states = report => Object.fromEntries(report.entries.map(entry => [entry.id, entry.viewports.map(row => row.state)]));
  assert.deepEqual(states(same.report).button, ['complete', 'complete']);
  assert.equal(same.report.entries.some(entry => entry.id === 'hero'), false);
  assert.deepEqual(same.report.runs.map(run => run.noFixture), [['hero'], ['hero']]);
  assert.deepEqual(summarizeReport(same.report).noFixture, { count: 1, ids: ['hero'], omitted: 0 });
  assert.equal(summarizeReport(same.report).verdict, 'match');
  assert.equal(summarizeReport(same.report).counts.unexplained, 0);

  // Run C: one component changed, one removed, one added.
  colorOf = { ...colors, card: '#f60', fresh: '#999' };
  catalogue = [entry('card'), entry('banner'), entry('fresh'), { id: 'hero', name: 'Hero', has_styleguide: false }];
  const c = await capture({ configPath, side: 'styleguide' });
  const changed = await compareRuns({ runsRoot, runA: a.run.id, runB: c.run.id, outputDir: join(directory, 'changed'), kind: 'self-baseline' });
  const rows = states(changed.report);
  assert.deepEqual(rows.button, ['missing', 'missing'], 'A removed component is reported as missing, not skipped.');
  assert.deepEqual(rows.fresh, ['missing', 'missing'], 'An added component is reported as missing in the earlier run.');
  assert.deepEqual(rows.card, ['complete', 'complete']);
  assert.ok(changed.report.entries.find(entry => entry.id === 'card').viewports.every(row => row.artifacts.screenshot.diff.ratio > 0));
  assert.ok(changed.report.entries.every(entry => entry.kind === 'component'));
  const summary = summarizeReport(changed.report);
  assert.equal(summary.counts.unexplained, 1);
  assert.ok(summary.counts.incomplete === 2, JSON.stringify(summary.counts));

  // An unknown component named in `include` stops the capture before any run exists.
  await writeFile(configPath, config({ include: ['card', 'gone'] }));
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /no component "gone"/);
  // A subset is captured as named.
  await writeFile(configPath, config({ include: ['card'] }));
  assert.deepEqual((await capture({ configPath, side: 'styleguide' })).run.settings.targets.map(target => target.id), ['card']);
  // A wrong mount and a catalogue with a bad ID stop the capture with a named error.
  await writeFile(configPath, config({ mount: '/other' }));
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /HTTP 404/);
  await writeFile(configPath, config());
  catalogue = [entry('card'), { id: '../x' }];
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /no usable ID/);

  const stored = JSON.parse(await readFile(a.manifestPath, 'utf8'));
  assert.equal(stored.settings.targets.length, 3);
  console.log('Styleguide component target checks pass.');
} finally {
  await new Promise(resolve => site.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
