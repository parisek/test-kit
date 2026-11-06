// Explicit browser integration check. npm test does not discover this file.
// A synthetic styleguide (example-site data only) serves a component list and one render page for each component.
// It checks R13.3: one target for each component, a self-baseline pair, a removed component, an unknown component
// and a component with no fixture (skipped, listed, no request).
// It also checks the opt-in variant and page targets (R13.52): one target for each variant and page, the variant query in the render URL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';

const colors = { button: '#c00', card: '#0a0', banner: '#00c' };
let catalogue = [];
let colorOf = { ...colors };
let pageCatalogue = [];
const variantColor = { 'button/dark': '#222', 'home/': '#eee', 'home/empty': '#ddd' };
const requests = [];
const site = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  requests.push(url.pathname);
  const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
  if (url.pathname === '/styleguide/api/components') return send(200, 'application/json', JSON.stringify(catalogue));
  if (url.pathname === '/styleguide/api/pages') return send(200, 'application/json', JSON.stringify(pageCatalogue));
  const pageMatch = /^\/styleguide\/render\/page\/([a-z-]+)$/.exec(url.pathname);
  if (pageMatch && variantColor[`${pageMatch[1]}/${url.searchParams.get('variant') ?? ''}`]) return send(200, 'text/html', `<!doctype html><title>${pageMatch[1]}</title><style>html,body{margin:0}div{width:200px;height:90px;background:${variantColor[`${pageMatch[1]}/${url.searchParams.get('variant') ?? ''}`]}}</style><div></div>`);
  const match = /^\/styleguide\/render\/component\/([a-z-]+)$/.exec(url.pathname);
  const variant = url.searchParams.get('variant');
  const color = match && (variant ? variantColor[`${match[1]}/${variant}`] : colorOf[match[1]]);
  if (color) return send(200, 'text/html', `<!doctype html><title>${match[1]}</title><style>html,body{margin:0}div{width:160px;height:80px;background:${color}}</style><div></div>`);
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
  // R4.5: --target selects among the catalogue components. The check runs after the catalogue read.
  colorOf = { ...colors };
  catalogue = [entry('card'), entry('button'), entry('banner')];
  await writeFile(configPath, config());
  const picked = await capture({ configPath, side: 'styleguide', targets: ['card'] });
  assert.deepEqual(picked.run.selection, { targets: ['card'] });
  assert.deepEqual([...new Set(picked.run.captures.map(row => row.targetId))], ['card'], 'Only the selected component is captured.');
  assert.equal(picked.run.captures.length, 2);
  assert.deepEqual(picked.run.settings.targets.map(target => target.id), ['banner', 'button', 'card'], 'The run keeps the full target list.');
  const before = (await readdir(runsRoot)).length;
  await assert.rejects(capture({ configPath, side: 'styleguide', targets: ['gone'] }), /Unknown target/);
  assert.equal((await readdir(runsRoot)).length, before, 'An unknown target leaves no run directory.');

  // A wrong mount and a catalogue with a bad ID stop the capture with a named error.
  await writeFile(configPath, config({ mount: '/other' }));
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /HTTP 404/);
  await writeFile(configPath, config());
  catalogue = [entry('card'), { id: '../x' }];
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /no usable ID/);

  // R13.52: variants and pages are opt-in. Without the keys the run above stays as it was.
  colorOf = { ...colors };
  catalogue = [{ ...entry('button'), has_default_variant: true, variants: [{ id: 'dark', title: 'Dark' }] }, entry('card')];
  pageCatalogue = [{ id: 'home', name: 'Home', has_styleguide: true, has_default_variant: true, variants: [{ id: 'empty', title: 'Empty' }] }, { id: 'blog', name: 'Blog', has_styleguide: false }];
  await writeFile(configPath, config());
  assert.deepEqual((await capture({ configPath, side: 'styleguide' })).run.settings.targets.map(target => target.id), ['button', 'card'], 'No variants and no pages without the keys.');
  await writeFile(configPath, config({ variants: true, pages: true }));
  requests.length = 0;
  const v = await capture({ configPath, side: 'styleguide' });
  assert.deepEqual(v.run.settings.targets.map(target => [target.id, target.kind]), [['button', 'component'], ['button--dark', 'component'], ['card', 'component'], ['page--home', 'page'], ['page--home--empty', 'page']]);
  assert.equal(v.run.state, 'complete');
  assert.equal(v.run.captures.length, 10);
  for (const row of v.run.captures) assert.equal(row.state, 'captured', JSON.stringify(row));
  assert.deepEqual(v.run.targetSource.noFixture, ['page--blog']);
  assert.equal(requests.some(url => url.includes('/blog')), false, 'No request goes to a page with no fixture.');
  assert.deepEqual(v.run.settings.targets.find(target => target.id === 'button--dark').path, '/styleguide/render/component/button?canvas&variant=dark');
  const w = await capture({ configPath, side: 'styleguide' });
  const withVariants = await compareRuns({ runsRoot, runA: v.run.id, runB: w.run.id, outputDir: join(directory, 'variants'), kind: 'self-baseline' });
  assert.deepEqual(withVariants.report.entries.map(entry => entry.id), ['button', 'button--dark', 'card', 'page--home', 'page--home--empty']);
  assert.deepEqual(withVariants.report.entries.map(entry => entry.kind), ['component', 'component', 'component', 'page', 'page']);
  assert.equal(summarizeReport(withVariants.report).verdict, 'match');
  // A variant renders its own file: a changed variant changes only that target.
  variantColor['button/dark'] = '#900';
  const x = await capture({ configPath, side: 'styleguide' });
  const changedVariant = await compareRuns({ runsRoot, runA: v.run.id, runB: x.run.id, outputDir: join(directory, 'variant-changed'), kind: 'self-baseline' });
  const ratio = id => changedVariant.report.entries.find(entry => entry.id === id).viewports.map(row => row.artifacts.screenshot.diff.ratio);
  assert.ok(ratio('button--dark').every(value => value > 0));
  assert.ok(ratio('button').every(value => value === 0));
  // --target selects one variant, and an unknown variant stops the capture before a run exists.
  assert.deepEqual((await capture({ configPath, side: 'styleguide', targets: ['button--dark'] })).run.selection, { targets: ['button--dark'] });
  await writeFile(configPath, config({ variants: true, pages: true, include: ['button--gone'] }));
  await assert.rejects(capture({ configPath, side: 'styleguide' }), /no component "button--gone"/);

  const stored = JSON.parse(await readFile(a.manifestPath, 'utf8'));
  assert.equal(stored.settings.targets.length, 3);
  console.log('Styleguide component target checks pass.');
} finally {
  await new Promise(resolve => site.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
