// Explicit browser check of the layout artifact (R6.14, R6.15, #350). The default unit suite does not capture pages.
// The page is synthetic: one example-site page whose CSS the server changes between two captures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../../src/capture/index.js';
import { MAX_NUMBER } from '../../src/layout/record.js';
import { compareRuns } from '../../src/compare/runs.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { summarizeReport } from '../../src/query/summary.js';
import { targetClass, cellState, targetState } from '../../src/report/classify.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-layout-'));
// `gap` and `size` are the two CSS values a variant changes; `items` is the length of the list.
let variant = { gap: '16px', size: '32px', items: 3 };
const page = ({ gap, size, items }) => `<!doctype html><html lang="en"><head><title>Example site</title><style>
@layer theme { :root { --spacing-4: 16px; --spacing-6: 24px; --text-hero: 2rem; --radius-card: 12px; --color-ink: oklch(0.2 0.02 260); --color-paper: #ffffff; --size-32: 32px; } }
body { margin: 0; font-family: "Example Sans", Arial, sans-serif; }
.cards { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: ${gap}; padding: 8px 12px; }
.card { box-sizing: border-box; width: 200px; height: 120px; border-radius: var(--radius-card); background: var(--color-paper); color: var(--color-ink); border: 1px solid rgb(0 0 0 / 10%); }
h1 { font-size: ${size}; line-height: 1.25; font-weight: 700; letter-spacing: -0.5px; color: var(--color-ink); }
.pill { display: inline-block; padding: 4px 12px; border-radius: calc(infinity * 1px); }
</style></head><body><h1>Example site</h1><span class="pill">Pill</span><div class="cards">${'<div class="card">Card</div>'.repeat(items)}</div></body></html>`;
// A box above the bound: only a radius takes the bound, so this layout file is refused as a whole (#384).
// The clip keeps the page short, so the screenshot itself completes.
const tall = '<!doctype html><html lang="en"><head><title>Example site</title><style>body { margin: 0; } .clip { height: 100px; overflow: hidden; } .tall { height: 1200000px; }</style></head><body><div class="clip"><div class="tall">Tall</div></div></body></html>';
const site = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(request.url === '/tall' ? tall : page(variant));
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
try {
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}`, settle: { disableMotion: true } } },
    targets: [
      { id: 'home', kind: 'page', path: '/', layout: { parts: [{ id: 'title', selector: 'h1' }, { id: 'cards', selector: '.cards' }, { id: 'card', selector: '.card', repeat: true }, { id: 'pill', selector: '.pill' }] } },
      { id: 'plain', kind: 'page', path: '/plain' },
      { id: 'tall', kind: 'page', path: '/tall', layout: { parts: [{ id: 'tall', selector: '.tall' }] } },
    ],
    viewports: [{ id: 'wide', width: 1024, height: 768 }], artifacts: ['screenshot', 'layout'], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const runsRoot = join(directory, 'runs');
  const first = await capture({ configPath, side: 'local' });
  const second = await capture({ configPath, side: 'local' });
  assert.equal(first.run.state, 'complete', 'A target without layout parts does not keep the run partial.');
  const home = first.run.captures.find(item => item.targetId === 'home');
  const plain = first.run.captures.find(item => item.targetId === 'plain');
  assert.equal(plain.artifacts.layout, undefined, 'A target without parts stores no layout entry.');
  assert.equal(home.artifacts.layout.state, 'captured');
  assert.equal(home.artifacts.layout.path, 'layout/home/wide.json');
  assert.match(home.artifacts.layout.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.run.tools.some(tool => tool.artifact === 'layout' && tool.name === 'test-kit-layout'));
  const stored = JSON.parse(await readFile(join(first.runDir, home.artifacts.layout.path), 'utf8'));
  const [title, cards, card, pill] = stored.parts;
  assert.deepEqual(title.records[0].type, { family: 'Example Sans', size: 32, weight: 700, lineHeight: 1.25, letterSpacing: -0.5 });
  // The font size 32px fits the --text-hero family; --size-32 has the same value and the wrong name.
  assert.equal(title.records[0].tokens['type.size'], '--text-hero');
  assert.deepEqual(cards.records[0].layout, { display: 'flex', direction: 'row', wrap: 'wrap', justify: 'space-between', align: 'center', gap: 16, padding: [8, 12, 8, 12] });
  assert.equal(cards.records[0].tokens['layout.gap'], '--spacing-4');
  assert.equal(card.count, 3);
  assert.deepEqual(card.records[0].box, { width: 200, height: 120 });
  assert.equal(card.records[0].paint.radius, 12);
  assert.equal(card.records[0].tokens['paint.radius'], '--radius-card');
  assert.equal(card.records[0].paint.background, '#ffffff');
  assert.equal(card.records[0].tokens['paint.background'], '--color-paper');
  // Chromium serialises the oklch() token as oklch(); the record holds the hex of the same colour.
  assert.match(card.records[0].paint.color, /^#[0-9a-f]{6}$/);
  assert.equal(card.records[0].tokens['paint.color'], '--color-ink');
  assert.equal(card.records[0].paint.borderWidth, 1);
  assert.equal(card.records[0].paint.borderColor, '#0000001a');
  // `calc(infinity * 1px)` (Tailwind 4 `rounded-full`) computes to an engine limit. The record stores the shared bound,
  // so the reader accepts the file that capture wrote (#384).
  assert.equal(pill.records[0].paint.radius, MAX_NUMBER);

  // Two captures of the same page match.
  const same = await compareRuns({ runsRoot, runA: first.run.id, runB: second.run.id, outputDir: join(directory, 'same') });
  const sameHome = same.report.entries.find(entry => entry.id === 'home');
  assert.equal(sameHome.viewports[0].artifacts.layout.state, 'complete');
  assert.equal(sameHome.viewports[0].artifacts.layout.diff.changed, false);
  // Before #384 the pill refused both files, and this cell was `failed` with a generic diagnostic.
  assert.equal(sameHome.viewports[0].artifacts.layout.diff.counts.parts, 4);
  assert.equal(sameHome.viewports[0].artifacts.layout.diff.counts.match, 4);
  assert.equal(same.report.findings.filter(item => item.artifact === 'layout').length, 0);
  assert.equal(targetClass(same.report, sameHome), 'match');
  assert.equal(same.report.entries.find(entry => entry.id === 'plain').viewports[0].artifacts.layout, undefined);
  assert.equal(summarizeReport(same.report).layout, undefined, 'No layout difference adds no summary key.');
  // A box height above the bound stays as it is. The reader refuses the file, and query names the part, the property and the value.
  const tallCell = same.report.entries.find(entry => entry.id === 'tall').viewports[0];
  assert.equal(tallCell.artifacts.layout.state, 'failed');
  const tallQuery = await queryArtifact(same.reportPath, { target: 'tall', viewport: 'wide', artifact: 'layout' });
  assert.equal(tallQuery.state, 'failed');
  assert.match(tallQuery.diagnostic, /^The layout file of run A is invalid\. Invalid layout snapshot: part tall, property box\.height, value 1200000 \(the bound is 1000000\)\.$/);

  // One gap and one font size change: exactly those differences, with their tokens.
  variant = { gap: '24px', size: '40px', items: 3 };
  const changed = await capture({ configPath, side: 'local' });
  const report = await compareRuns({ runsRoot, runA: first.run.id, runB: changed.run.id, outputDir: join(directory, 'changed') });
  const index = report.report.entries.find(entry => entry.id === 'home').viewports[0].artifacts.layout;
  assert.equal(index.state, 'complete');
  const differences = index.diff.differences.map(item => [item.part, item.property, item.a, item.b, item.tokenA ?? null, item.tokenB ?? null]);
  // The title box grows with its font size, so its height differs too. The line-height ratio stays 1.25.
  assert.deepEqual(differences, [
    ['title', 'box.height', 40, 50, null, null],
    ['title', 'type.size', 32, 40, '--text-hero', null],
    ['cards', 'layout.gap', 16, 24, '--spacing-4', '--spacing-6'],
  ]);
  assert.equal(report.report.findings.filter(item => item.artifact === 'layout').length, 3);
  assert.equal(targetClass(report.report, report.report.entries.find(entry => entry.id === 'home')), 'unexplained');
  assert.deepEqual(report.report.checks.layout, { basis: 'relative', layer: 'package', title: 'Layout record difference' });
  assert.deepEqual(summarizeReport(report.report).layout, { cells: 1, differs: 2, differences: 3 });
  const query = await queryArtifact(report.reportPath, { target: 'home', viewport: 'wide', artifact: 'layout', maxLines: 2 });
  assert.equal(query.diff.differences.length, 2);
  assert.equal(query.diff.differencesOmitted, 1);
  assert.equal(query.diff.counts.differences, 3);

  // A list that grows from 3 to 4 items gives one count finding and nothing else.
  variant = { gap: '16px', size: '32px', items: 4 };
  const grown = await capture({ configPath, side: 'local' });
  const count = await compareRuns({ runsRoot, runA: first.run.id, runB: grown.run.id, outputDir: join(directory, 'count') });
  const countIndex = count.report.entries.find(entry => entry.id === 'home').viewports[0].artifacts.layout;
  assert.deepEqual(countIndex.diff.differences, [{ part: 'card', property: 'count', kind: 'count', a: 3, b: 4 }]);
  assert.deepEqual(summarizeReport(count.report).layout, { cells: 1, differs: 1, count: 1, differences: 1 });

  // The stored file is untrusted: a changed file fails the artifact, so the cell and the verdict are incomplete.
  const file = join(grown.runDir, 'layout/home/wide.json');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"count":4', '"count":5'));
  const tampered = await compareRuns({ runsRoot, runA: first.run.id, runB: grown.run.id, outputDir: join(directory, 'tampered') });
  const tamperedHome = tampered.report.entries.find(entry => entry.id === 'home');
  assert.equal(tamperedHome.viewports[0].artifacts.layout.state, 'failed');
  assert.equal(cellState(tamperedHome, 'wide'), 'failed');
  assert.equal(targetState(tamperedHome), 'failed');
  assert.equal(summarizeReport(tampered.report).verdict, 'incomplete');
  console.log('Layout capture, token rule, comparison, count finding, summary, query and the untrusted read pass.');
} finally {
  site.closeAllConnections(); await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true });
}

