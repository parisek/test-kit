// Explicit browser integration check of the design-revision loop (#350, part C). npm test does not discover this file.
// R3.12, R4.6, R6.14, R9.14: a synthetic canvas changes over three revisions. Each import is a run with layout records.
// A drift pair lists what changed in the design. The owner decides per difference, and the next reports read the
// decisions bound to the design value. A convergence pair against a synthetic site reads the same decisions.
// The fixture (tests/fixtures/claude-design) has a stub runtime only. The real canvas runtime is never in this repository.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as cli } from '../../src/cli/run.js';
import { capture } from '../../src/capture/index.js';
import { findingIsExplained, artifactClass, targetClass } from '../../src/report/classify.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-design-decisions-'));
// One artboard. A revision sets the gap token of the row and the font size of the title. The title has a fixed
// height and the row a fixed tile size, so a revision changes exactly those two properties and no box.
const artboard = ({ gap, size }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Decide</title>
<link rel="stylesheet" href="ds/tokens.css"><script src="./support.js"></script>
<style>.title { margin: 0; height: 48px; font-size: ${size}; font-weight: 700; line-height: 1.25; } .tiles { display: flex; gap: var(${gap}); margin-top: 24px; } .tile { width: 100px; height: 60px; background: #eef2fb; }</style>
</head><body><x-dc><main class="page"><h2 class="title">Example site</h2><div class="tiles"><div class="tile"></div><div class="tile"></div></div></main></x-dc></body></html>`;
// The site has other markup and other token names. `selectorBySide` and `layout.aliases` bridge them.
let site = { gap: '--spacing-4', size: '28px' };
const page = ({ gap, size }) => `<!doctype html><html lang="en"><head><title>Example site</title><style>
:root { --spacing-4: 16px; --spacing-6: 24px; }
html, body { margin: 0; background: #ffffff; color: #1d1d1f; font: 16px/1.5 sans-serif; }
.page { padding: 24px; }
h1.hero { margin: 0; height: 48px; font-size: ${size}; font-weight: 700; line-height: 1.25; }
.row { display: flex; gap: var(${gap}); margin-top: 24px; } .cell { width: 100px; height: 60px; background: #eef2fb; }
</style></head><body><main class="page"><h1 class="hero">Example site</h1><div class="row"><div class="cell"></div><div class="cell"></div></div></main></body></html>`;
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page(site)); });
await new Promise(done => server.listen(0, '127.0.0.1', done));

// The command line prints one line of JSON. A failed command returns its stderr.
async function command(args) {
  const out = [], err = [];
  const code = await cli(args, { out: { write: chunk => out.push(chunk) }, err: { write: chunk => err.push(chunk) } });
  return { code, output: out.length ? JSON.parse(out.join('')) : null, error: err.join('') };
}
async function ok(args) {
  const result = await command(args);
  assert.equal(result.code, 0, `${args[0]} fails: ${result.error}`);
  return result.output;
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const layoutOf = report => report.entries.find(entry => entry.id === 'home').viewports[0].artifacts.layout;
const listed = report => layoutOf(report).diff.differences.map(item => [item.part, item.property, item.a, item.b, item.tokenA ?? null, item.tokenB ?? null]);
const layoutFindings = report => report.findings.filter(item => item.artifact === 'layout');
const findingOf = (report, part) => layoutFindings(report).find(item => item.part === part);

try {
  const root = join(directory, 'canvas');
  await cp(new URL('../fixtures/claude-design/', import.meta.url), root, { recursive: true });
  const revise = revision => writeFile(join(root, 'project/Decide.dc.html'), artboard(revision));
  const configPath = join(directory, 'test-kit.config.json');
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    sides: { site: { origin: `http://127.0.0.1:${server.address().port}` }, design: { kind: 'design', provider: 'claude-design', root: 'canvas' } },
    targets: [{ id: 'home', kind: 'page', path: '/', design: { wide: 'Decide.dc.html' },
      layout: { parts: [{ id: 'title', selector: 'h1.hero', selectorBySide: { design: '.title' } }, { id: 'row', selector: '.row', selectorBySide: { design: '.tiles' } }] } }],
    viewports: [{ id: 'wide', width: 800, height: 600 }], artifacts: ['screenshot', 'layout'], layout: { aliases: { '--space-4': '--spacing-4', '--space-6': '--spacing-6' } },
    screenshot: { timeoutMs: 10000 }, runsRoot: 'runs',
  }));
  const runs = join(directory, 'runs');
  const importRevision = async (revision, label) => {
    await revise(revision);
    const result = await ok(['import', '--config', configPath, '--side', 'design', '--label', label]);
    assert.equal(result.state, 'complete');
    return result.id;
  };

  // Revision 1, then revision 2: one gap token and one font size change.
  const r1 = await importRevision({ gap: '--space-4', size: '28px' }, 'revision 1');
  const stored = await readJson(join(runs, r1, 'run.json'));
  assert.deepEqual(stored.settings.artifacts, ['screenshot', 'layout'], 'A design run that read layout records claims the artifact.');
  assert.equal(stored.captures[0].artifacts.layout.state, 'captured');
  assert.ok(stored.tools.some(tool => tool.artifact === 'layout' && tool.name === 'test-kit-layout'));
  const r2 = await importRevision({ gap: '--space-6', size: '36px' }, 'revision 2');

  // The drift report lists exactly those two differences, with their tokens.
  const drift = await readJson((await ok(['diff', r1, r2, '--config', configPath, '--kind', 'drift', '--output', 'out/drift'])).reportPath);
  assert.equal(drift.pair.kind, 'drift');
  assert.equal(layoutOf(drift).state, 'complete');
  assert.deepEqual(listed(drift), [['title', 'type.size', 28, 36, null, null], ['row', 'layout.gap', 16, 24, '--space-4', '--space-6']]);
  assert.equal(drift.decisions, undefined, 'No decision yet, so the report holds no decisions key.');

  // The owner decides: report-only for the font size, implement for the gap. The value of run B is the design value.
  const driftPath = join(directory, 'out/drift/report.json');
  const decide = (part, property, decision, report = driftPath) => ok(['record-decision', report, '--config', configPath, '--target', 'home', '--viewport', 'wide',
    '--part', part, '--property', property, '--decision', decision, '--reason', `Owner decision for ${part}.`, '--owner', 'example-team']);
  assert.equal((await decide('title', 'type.size', 'report-only')).designValue, 36);
  assert.equal((await decide('row', 'layout.gap', 'implement')).designValue, 24);
  assert.equal((await command(['record-decision', driftPath, '--config', configPath, '--target', 'home', '--viewport', 'wide', '--part', 'row', '--property', 'layout.gap',
    '--decision', 'report-only', '--reason', 'Again.', '--owner', 'example-team'])).code, 1, 'A second decision for the same design value is refused.');
  const file = await readJson(join(directory, 'test-kit.decisions.json'));
  assert.deepEqual(file.entries.map(item => [item.part, item.property, item.decision, item.designValue]), [['title', 'type.size', 'report-only', 36], ['row', 'layout.gap', 'implement', 24]]);

  // The third report: one explained (report-only), one unexplained (implement). Both stay listed.
  const third = await readJson((await ok(['diff', r1, r2, '--config', configPath, '--kind', 'drift', '--output', 'out/third'])).reportPath);
  assert.equal(layoutFindings(third).length, 2, 'A decided difference is shown, never dropped.');
  assert.deepEqual(findingOf(third, 'title').decision, { decision: 'report-only', status: 'active' });
  assert.deepEqual(findingOf(third, 'row').decision, { decision: 'implement', status: 'active' });
  assert.equal(findingIsExplained(third, findingOf(third, 'title')), true);
  assert.equal(findingIsExplained(third, findingOf(third, 'row')), false);
  assert.equal(artifactClass(third, third.entries[0], 'wide', 'layout'), 'unexplained');
  const summary = await ok(['summary', join(directory, 'out/third/report.json')]);
  assert.deepEqual(summary.decisions, { active: 2, stale: 0, absent: 0, unchecked: 0 });
  const query = await ok(['query', join(directory, 'out/third/report.json'), '--target', 'home', '--viewport', 'wide', '--artifact', 'layout']);
  assert.deepEqual(query.diff.differences.map(item => [item.part, item.decision]), [['title', { decision: 'report-only', status: 'active' }], ['row', { decision: 'implement', status: 'active' }]]);

  // Revision 3 moves the report-only property again. The binding bites: the entry is stale and the difference asks again.
  const r3 = await importRevision({ gap: '--space-6', size: '44px' }, 'revision 3');
  const moved = await readJson((await ok(['diff', r2, r3, '--config', configPath, '--kind', 'drift', '--output', 'out/moved'])).reportPath);
  assert.deepEqual(listed(moved), [['title', 'type.size', 36, 44, null, null]]);
  assert.deepEqual(findingOf(moved, 'title').decision, { decision: 'report-only', status: 'stale' });
  assert.equal(findingIsExplained(moved, findingOf(moved, 'title')), false);
  assert.equal(artifactClass(moved, moved.entries[0], 'wide', 'layout'), 'unexplained');
  assert.deepEqual(moved.decisions.map(item => [item.part, item.status]), [['title', 'stale'], ['row', 'absent']]);
  assert.match(moved.decisions[0].diagnostic, /recorded 36, now 44/);
  assert.deepEqual((await ok(['summary', join(directory, 'out/moved/report.json')])).decisions, { active: 0, stale: 1, absent: 1, unchecked: 0 });

  // The gap: a convergence pair of the design (A) and the site (B). The site still has the old gap and the old size.
  const before = await capture({ configPath, side: 'site' });
  assert.equal(before.run.state, 'complete');
  const gap = await readJson((await ok(['diff', r2, before.run.id, '--config', configPath, '--output', 'out/gap'])).reportPath);
  assert.equal(gap.pair.kind, 'convergence');
  assert.equal(layoutOf(gap).state, 'complete', 'The design side and the site compare: a claude-design run binds no settle recipe (R8.15).');
  assert.deepEqual(listed(gap), [['title', 'type.size', 36, 28, null, null], ['row', 'layout.gap', 24, 16, '--space-6', '--spacing-4']]);
  assert.equal(findingIsExplained(gap, findingOf(gap, 'title')), true, 'The report-only decision holds for the same design value in a convergence pair.');
  assert.equal(findingIsExplained(gap, findingOf(gap, 'row')), false);
  // The site implements the gap with its own token. The alias makes it a match, the gap closes and the entry is absent.
  site = { gap: '--spacing-6', size: '28px' };
  const after = await capture({ configPath, side: 'site' });
  const closed = await readJson((await ok(['diff', r2, after.run.id, '--config', configPath, '--output', 'out/closed'])).reportPath);
  assert.deepEqual(listed(closed), [['title', 'type.size', 36, 28, null, null]]);
  assert.deepEqual(closed.decisions.map(item => [item.part, item.status]), [['title', 'active'], ['row', 'absent']]);
  assert.equal(artifactClass(closed, closed.entries[0], 'wide', 'layout'), 'explained');
  assert.equal(targetClass(closed, closed.entries[0]), 'unexplained', 'The screenshot finding still counts: a decision explains layout findings only.');

  // An invalid decisions file fails the comparison before any report is written.
  await writeFile(join(directory, 'bad.json'), JSON.stringify({ schemaVersion: 1, entries: [{ ...file.entries[0], designValue: 99 }] }));
  const refused = await command(['diff', r1, r2, '--config', configPath, '--kind', 'drift', '--output', 'out/refused', '--decisions', join(directory, 'bad.json')]);
  assert.equal(refused.code, 1);
  assert.match(refused.error, /fingerprint does not match/);
  await assert.rejects(access(join(directory, 'out/refused')), 'No output directory exists.');
  // A drift pair needs two design runs of one design side, in the order of their imports.
  const mixed = await command(['diff', r2, after.run.id, '--config', configPath, '--kind', 'drift', '--output', 'out/mixed']);
  assert.equal(mixed.code, 1);
  assert.match(mixed.error, /two design runs of the same design side/);
  await assert.rejects(access(join(directory, 'out/mixed')), 'No output directory exists.');
  // The reversed order: run B gives the design value, so the later import must be run B. Both runs and times are named.
  const reversed = await command(['diff', r2, r1, '--config', configPath, '--kind', 'drift', '--output', 'out/reversed']);
  assert.equal(reversed.code, 1);
  assert.match(reversed.error, /earlier import as run A/);
  for (const id of [r1, r2]) {
    assert.ok(reversed.error.includes(id), `The message names ${id}.`);
    assert.ok(reversed.error.includes(new Date((await readJson(join(runs, id, 'run.json'))).at).toISOString()), `The message names the time of ${id}.`);
  }
  await assert.rejects(access(join(directory, 'out/reversed')), 'No output directory exists.');
  console.log('Design drift, decisions bound to the design value, stale on a moved value, and the convergence gap pass.');
} finally {
  server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true });
}
