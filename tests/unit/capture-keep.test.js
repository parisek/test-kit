import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeKept, runProblem, entryProblem, keptEntry, expectedFiles, keptCount } from '../../src/capture/keep.js';
import { createKeepFinder, copyKeptFiles, listRunIds } from '../../src/capture/keep-store.js';
import { captureRecipe, settleRecipe, settingsHash } from '../../src/config/settings.js';
import { sanitizeWarnings, captureWarningLines, warningTotals, cellWarningsText, captureWarningsSentence, REFERENCE_KEPT } from '../../src/report/warnings.js';
import { parseCommand, dispatch } from '../../src/cli/run.js';

const SOURCE_ID = '2026-11-01T10-00-00-000Z-111-abcdef1';
const OLDER_ID = '2026-10-01T10-00-00-000Z-111-abcdef1';
const SOURCE_AT = '2026-11-01T10:00:00.000Z';
const side = { origin: 'https://example-site.test', remote: true, userAgent: 'Example/1.0', settle: { waitMs: 100 } };
const viewport = { id: 'desktop', width: 400, height: 300, deviceScaleFactor: 1 };
const target = { id: 'home', kind: 'page', title: 'home', path: '/' };
const config = { targets: [target], viewports: [viewport], sides: { production: side }, screenshot: { timeoutMs: 2500 }, artifacts: ['screenshot', 'status'] };
const recipe = captureRecipe(config, 'production', target);
const settleHash = settingsHash(settleRecipe(config, 'production', target));
const provenance = { status: { tool: 'playwright', version: '1.64.0', browserVersion: '156.0', settingsHash: 'sha256:status' } };
const requested = ['screenshot', 'status'];
const tools = [{ name: 'playwright', version: '1.64.0', settingsHash: 'sha256:run' }, { name: 'chromium', version: '156.0', settingsHash: 'sha256:run' }];
const current = { side: 'production', declaration: side, settingsHash: 'sha256:run', tools };
const files = expectedFiles('home', 'desktop', requested);
const entry = () => ({ targetId: 'home', viewportId: 'desktop', settleHash, state: 'captured', path: files.screenshot, statusCode: 200, finalPath: '/', width: 400, height: 300, deviceScaleFactor: 1,
  scopeHash: settingsHash(recipe.scope), recipe: structuredClone(recipe),
  artifacts: { status: { kind: 'status', ...provenance.status, state: 'captured', path: files.status, bytes: 40 } } });
const source = (over = {}) => ({ id: SOURCE_ID, at: SOURCE_AT, side: 'production', state: 'complete', settingsHash: 'sha256:run', tools: structuredClone(tools),
  settings: { targets: [structuredClone(target)], viewports: [viewport], sides: { production: structuredClone(side) } }, captures: [entry()], ...over });
const cell = (over = {}) => ({ target, viewport, requested, provenance, recipe, settleHash, ...over });
const problem = (run, e = run.captures[0], c = cell()) => runProblem(run, current) ?? entryProblem(e, run, c);

test('a complete run of the same remote side with an equal entry may supply the cell (R5.13)', () => {
  assert.equal(problem(source()), null);
});

test('rule 1: the side ID and every key of the stored side declaration must be equal (R5.13)', () => {
  assert.equal(runProblem(source({ side: 'staging' }), current), 'side');
  for (const [key, value] of Object.entries({ origin: 'https://other.example-site.test', userAgent: 'Other/2.0', challenge: 'cloudflare', thirdParty: 'block', allowOrigins: [{ origin: 'https://fonts.example-site.test', types: ['font'] }] })) {
    const run = source();
    run.settings.sides.production[key] = value;
    assert.equal(runProblem(run, current), 'declaration', key);
  }
  const missing = source();
  delete missing.settings.sides.production.userAgent;
  assert.equal(runProblem(missing, current), 'declaration', 'a removed key');
});

test('rule 2: the settings hash and the Playwright and Chromium versions must be equal (R5.13, R8.9)', () => {
  assert.equal(runProblem(source({ settingsHash: 'sha256:other' }), current), 'settings');
  const chromium = source();
  chromium.tools[1].version = '157.0';
  assert.equal(runProblem(chromium, current), 'tools');
  const playwright = source();
  playwright.tools[0].version = '1.65.0';
  assert.equal(runProblem(playwright, current), 'tools');
  assert.equal(runProblem(source({ tools: [] }), current), 'tools');
});

test('rule 3: the stored target declaration must equal the current one (R5.13)', () => {
  for (const change of [{ path: '/other' }, { selector: '.hero' }, { settle: { waitMs: 5 } }]) {
    const run = source();
    run.settings.targets[0] = { ...target, ...change };
    assert.equal(entryProblem(run.captures[0], run, cell()), 'target', JSON.stringify(change));
  }
  const gone = source();
  gone.settings.targets = [];
  assert.equal(entryProblem(gone.captures[0], gone, cell()), 'target');
});

test('rule 4: the entry and every selected artifact must be captured with equal provenance (R5.13)', () => {
  const failed = source();
  failed.captures[0].state = 'failed';
  assert.equal(problem(failed), 'entry');
  const artifactFailed = source();
  artifactFailed.captures[0].artifacts.status.state = 'failed';
  assert.equal(problem(artifactFailed), 'artifacts');
  const version = source();
  version.captures[0].artifacts.status.browserVersion = '155.0';
  assert.equal(problem(version), 'provenance');
  const extra = source();
  extra.captures[0].artifacts.html = { kind: 'html', state: 'captured', path: 'html/home/desktop.txt', bytes: 1 };
  assert.equal(problem(extra), 'artifacts');
  const none = source();
  none.captures[0].artifacts = {};
  assert.equal(problem(none), 'artifacts');
  const elsewhere = source();
  elsewhere.captures[0].path = '../outside/home.png';
  assert.equal(problem(elsewhere), 'entry');
  const statusPath = source();
  statusPath.captures[0].artifacts.status.path = 'status/other/desktop.json';
  assert.equal(problem(statusPath), 'artifacts');
  assert.equal(problem(source(), source().captures[0], cell({ requested: ['screenshot', 'status', 'behavior'] })), 'behavior');
  const noScreenshot = source();
  assert.equal(problem(noScreenshot, noScreenshot.captures[0], cell({ requested: ['status'] })), 'artifacts');
});

test('rule 5: the stored recipe must equal the recipe a fresh capture writes, version included (R5.13, R5.6, R8.16)', () => {
  const version = source();
  version.captures[0].recipe.version = recipe.version + 1;
  assert.equal(problem(version), 'recipe');
  const settle = source();
  settle.captures[0].recipe.settle = { ...recipe.settle, waitMs: 999 };
  assert.equal(problem(settle), 'recipe');
  const old = source();
  delete old.captures[0].recipe;
  assert.equal(problem(old), 'recipe');
  const hash = source();
  hash.captures[0].settleHash = 'sha256:other';
  assert.equal(problem(hash), 'recipe');
});

test('rule 6: only a complete run supplies a cell (R5.13)', () => {
  assert.equal(runProblem(source({ state: 'partial' }), current), 'state');
});

test('rule 7: only a remote side keeps, on both the current and the stored declaration (R5.13)', () => {
  assert.equal(runProblem(source(), { ...current, declaration: { ...side, remote: false } }), 'remote');
  const stored = source();
  stored.settings.sides.production.remote = false;
  assert.equal(runProblem(stored, current), 'remote');
});

test('a run with a bad identity supplies nothing (R5.13)', () => {
  assert.equal(runProblem(source({ id: 'not-a-run-id' }), current), 'run');
  assert.equal(runProblem(source({ at: 'yesterday' }), current), 'run');
  assert.equal(runProblem(null, current), 'run');
});

test('a kept entry equals a fresh entry in recipe and hashes, and adds only kept and its warning (R5.13)', () => {
  const run = source();
  const kept = keptEntry(run.captures[0], run);
  const { kept: provenanceField, warnings, ...rest } = kept;
  assert.deepEqual(rest, entry());
  assert.deepEqual(provenanceField, { runId: SOURCE_ID, at: SOURCE_AT });
  assert.deepEqual(warnings, [{ code: REFERENCE_KEPT, count: 1 }]);
  assert.equal(kept.scopeHash, run.captures[0].scopeHash);
  assert.equal(kept.settleHash, run.captures[0].settleHash);
  assert.deepEqual(kept.recipe, recipe);
  assert.equal(keptCount({ captures: [kept, entry()] }), 1);
});

test('a kept entry copies known keys only and keeps the warnings of the measurement (R5.11, R5.13)', () => {
  const run = source();
  Object.assign(run.captures[0], { evil: '<script>', warnings: [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 3 }, { code: REFERENCE_KEPT, count: 1 }], dropped: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 2 }, { bad: true }] });
  run.captures[0].artifacts.status.evil = 'x';
  const kept = keptEntry(run.captures[0], run);
  assert.equal(JSON.stringify(kept).includes('evil'), false);
  assert.deepEqual(kept.warnings, [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 3 }, { code: REFERENCE_KEPT, count: 1 }]);
  assert.deepEqual(kept.dropped, [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 2 }]);
});

test('a source entry that is itself kept passes its own provenance on, so the age stays true (R5.13)', () => {
  const run = source({ id: '2026-11-03T10-00-00-000Z-111-abcdef1', at: '2026-11-03T10:00:00.000Z' });
  run.captures[0].kept = { runId: OLDER_ID, at: '2026-10-01T10:00:00.000Z' };
  const kept = keptEntry(run.captures[0], run);
  assert.deepEqual(kept.kept, { runId: OLDER_ID, at: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(kept.warnings, [{ code: REFERENCE_KEPT, count: 1 }]);
});

test('a reader accepts kept only as exactly runId and at (R5.13)', () => {
  const good = { runId: SOURCE_ID, at: SOURCE_AT };
  assert.deepEqual(sanitizeKept(good), good);
  for (const bad of [null, [], 'x', {}, { runId: SOURCE_ID }, { ...good, extra: 1 }, { runId: '../etc', at: SOURCE_AT }, { runId: 'a/b', at: SOURCE_AT }, { runId: SOURCE_ID, at: 'yesterday' },
    { runId: SOURCE_ID, at: '2026-11-01' }, { runId: SOURCE_ID, at: '2026-13-45T10:00:00.000Z' }, { runId: 5, at: SOURCE_AT }, Object.create({ runId: SOURCE_ID, at: SOURCE_AT })]) {
    assert.equal(sanitizeKept(bad), null, JSON.stringify(bad));
  }
});

test('REFERENCE_KEPT is a valid R5.11 warning, prints a stderr line with its code, and the viewer helpers show it (R5.11, R5.13)', () => {
  const run = { captures: [{ warnings: [{ code: REFERENCE_KEPT, count: 1 }] }, { warnings: [{ code: REFERENCE_KEPT, count: 1 }] }, {}] };
  assert.deepEqual(sanitizeWarnings(run.captures[0].warnings), run.captures[0].warnings);
  assert.deepEqual(captureWarningLines(run), ['Warning REFERENCE_KEPT: 2 of 3 captures come from earlier runs. They are not new measurements.']);
  const row = { warnings: { a: [], b: [{ code: REFERENCE_KEPT, count: 1 }] } };
  assert.equal(cellWarningsText(row), 'A: none · B: REFERENCE_KEPT (1)');
  assert.equal(captureWarningsSentence(warningTotals({ entries: [{ viewports: [row] }] })), 'Capture warnings: REFERENCE_KEPT in 1 cell (1 in all).');
});

test('--keep-existing is a flag on capture only (R5.13, ADR 0009 answer 8) and there is no --force', () => {
  assert.equal(parseCommand(['capture', '--side', 'a', '--keep-existing']).options['keep-existing'], true);
  assert.equal(parseCommand(['capture', '--side', 'a']).options['keep-existing'], undefined);
  for (const command of ['run', 'before', 'after', 'import', 'diff']) assert.throws(() => parseCommand([command, '--keep-existing']), /Unknown option: --keep-existing/, command);
  assert.throws(() => parseCommand(['capture', '--side', 'a', '--force']), /Unknown option: --force/);
});

test('the stdout line adds kept only above zero, and stderr carries the warning line (R5.13)', async () => {
  const keptRun = { id: 'r', state: 'complete', captures: [{ kept: { runId: SOURCE_ID, at: SOURCE_AT }, warnings: [{ code: REFERENCE_KEPT, count: 1 }] }, {}] };
  let received;
  const call = async run => dispatch(parseCommand(['capture', '--side', 'a', '--keep-existing', '--config', '/nonexistent/test-kit.config.json']), { capture: async args => { received = args; return { run, manifestPath: '/x/run.json' }; } });
  const withKept = await call(keptRun);
  assert.equal(received.keepExisting, true);
  assert.equal(withKept.output.kept, 1);
  assert.ok(withKept.stderr.some(line => line.startsWith('Warning REFERENCE_KEPT:')));
  const without = await call({ id: 'r', state: 'complete', captures: [{}] });
  assert.equal(Object.hasOwn(without.output, 'kept'), false);
});

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-keep-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
async function writeSource(dir, { shot = png(400, 300) } = {}) {
  await mkdir(join(dir, 'screenshots/home'), { recursive: true });
  await mkdir(join(dir, 'status/home'), { recursive: true });
  await writeFile(join(dir, files.screenshot), shot);
  await writeFile(join(dir, files.status), '{"statusCode":200}');
}

test('copyKeptFiles copies the stored files to the same relative paths (R5.13)', async () => fixture(async root => {
  const sourceDir = join(root, 'src');
  const runDir = join(root, 'new');
  await writeSource(sourceDir);
  assert.equal(await copyKeptFiles({ sourceDir, runDir, entry: entry(), requested }), true);
  assert.deepEqual(await readFile(join(runDir, files.screenshot)), png(400, 300));
  assert.equal(await readFile(join(runDir, files.status), 'utf8'), '{"statusCode":200}');
}));

test('copyKeptFiles refuses a symbolic link, as the file or as a directory, and leaves nothing behind (R5.13)', async () => fixture(async root => {
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.png'), png(400, 300));
  const asFile = join(root, 'as-file');
  await writeSource(asFile);
  await rm(join(asFile, files.screenshot));
  await symlink(join(outside, 'secret.png'), join(asFile, files.screenshot));
  assert.equal(await copyKeptFiles({ sourceDir: asFile, runDir: join(root, 'n1'), entry: entry(), requested }), false);
  const asDirectory = join(root, 'as-dir');
  await mkdir(asDirectory);
  await symlink(outside, join(asDirectory, 'screenshots'));
  assert.equal(await copyKeptFiles({ sourceDir: asDirectory, runDir: join(root, 'n2'), entry: entry(), requested }), false);
  for (const name of ['n1', 'n2']) assert.deepEqual(await readdir(join(root, name), { recursive: true }).catch(() => []).then(list => list.filter(item => item.endsWith('.png') || item.endsWith('.json'))), []);
}));

test('copyKeptFiles fails when a file is missing, is not a PNG of the stored size, or the entry holds an unsafe ID (R5.13)', async () => fixture(async root => {
  const missing = join(root, 'missing');
  await writeSource(missing);
  await rm(join(missing, files.status));
  assert.equal(await copyKeptFiles({ sourceDir: missing, runDir: join(root, 'n1'), entry: entry(), requested }), false);
  await assert.rejects(readFile(join(root, 'n1', files.screenshot)), 'the first file is removed again');
  const wrong = join(root, 'wrong');
  await writeSource(wrong, { shot: png(10, 10) });
  assert.equal(await copyKeptFiles({ sourceDir: wrong, runDir: join(root, 'n2'), entry: entry(), requested }), false);
  const bad = join(root, 'bad');
  await writeSource(bad, { shot: Buffer.from('not a png at all, just text, long enough to pass') });
  assert.equal(await copyKeptFiles({ sourceDir: bad, runDir: join(root, 'n3'), entry: entry(), requested }), false);
  assert.equal(await copyKeptFiles({ sourceDir: missing, runDir: join(root, 'n4'), entry: { ...entry(), targetId: '../x' }, requested }), false);
}));

test('the finder takes the newest eligible run, skips unreadable and ineligible runs, and moves on after a failed copy (R5.13)', async () => {
  const ids = [OLDER_ID, '2026-10-15T10-00-00-000Z-111-abcdef1', SOURCE_ID, '2026-11-02T10-00-00-000Z-111-abcdef1', '2026-11-05T10-00-00-000Z-222-abcdef1'];
  const runs = {
    [SOURCE_ID]: source(),
    [OLDER_ID]: source({ id: OLDER_ID, at: '2026-10-01T10:00:00.000Z' }),
    '2026-10-15T10-00-00-000Z-111-abcdef1': source({ id: '2026-10-15T10-00-00-000Z-111-abcdef1', at: '2026-10-15T10:00:00.000Z', state: 'partial' }),
    '2026-11-02T10-00-00-000Z-111-abcdef1': null,
  };
  const reads = [];
  const read = async (_root, id) => { reads.push(id); if (!runs[id]) throw new Error('Invalid run'); return runs[id]; };
  const copied = [];
  // A temporary store holds one directory for each run ID.
  await fixture(async store => {
    for (const id of ids) await mkdir(join(store, id));
    await writeFile(join(store, 'notes.txt'), 'x');
    const finder = createKeepFinder({ root: store, excludeId: '2026-11-05T10-00-00-000Z-222-abcdef1', current, describe: () => cell(), read, copy: async args => { copied.push(args.sourceDir.split('/').at(-1)); return true; } });
    const kept = await finder({ target, viewport, runDir: '/new' });
    assert.equal(kept.kept.runId, SOURCE_ID);
    assert.deepEqual(reads, ['2026-11-02T10-00-00-000Z-111-abcdef1', SOURCE_ID], 'newest first; the run of the command is never read');
    assert.deepEqual(copied, [SOURCE_ID]);
    let calls = 0;
    const second = createKeepFinder({ root: store, excludeId: 'none', current, describe: () => cell(), read, copy: async () => ++calls > 1 });
    const fallback = await second({ target, viewport, runDir: '/new' });
    assert.equal(fallback.kept.runId, OLDER_ID, 'a failed copy tries the next eligible run');
    const none = createKeepFinder({ root: store, excludeId: 'none', current, describe: () => cell(), read, copy: async () => false });
    assert.equal(await none({ target, viewport, runDir: '/new' }), null);
    const empty = createKeepFinder({ root: join(store, 'absent'), excludeId: 'none', current, describe: () => cell(), read, copy: async () => true });
    assert.equal(await empty({ target, viewport, runDir: '/new' }), null);
    assert.deepEqual(await listRunIds(store), ['2026-11-05T10-00-00-000Z-222-abcdef1', '2026-11-02T10-00-00-000Z-111-abcdef1', SOURCE_ID, '2026-10-15T10-00-00-000Z-111-abcdef1', OLDER_ID]);
  });
});
