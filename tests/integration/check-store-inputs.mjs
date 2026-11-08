// Explicit browser integration check (#352, R12.1, R10.16, R12.5, R5.5).
// A project keeps its own inputs in `test-kit/inputs/`. Every command that writes the store leaves them unchanged,
// and a `files` design side reads its images from `test-kit/inputs/design` with every root-escape check in place.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, readlink, rm, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { run as cli } from '../../src/cli/run.js';
import { refreshStoreViewer } from '../../src/export/store-viewer.js';
import { DEFAULT_STORE, STORE_INPUTS } from '../../src/config/store.js';

const site = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Example site</title><style>body{margin:0;background:#fff}h1{margin:0;height:40px}</style><h1>Example site</h1>');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-reserved-'));
const inputs = join(directory, DEFAULT_STORE, STORE_INPUTS);
const png = () => { const image = new PNG({ width: 300, height: 200 }); image.data.fill(255); return PNG.sync.write(image); };

// Every entry under inputs/ with its type, bytes, link target, mode and mtime. lstat only: no link is followed.
async function snapshot(root = inputs) {
  const rows = [];
  const walk = async path => {
    const info = await lstat(path);
    const row = { path: relative(root, path) || '.', mode: info.mode, mtimeMs: info.mtimeMs };
    if (info.isSymbolicLink()) row.link = await readlink(path);
    else if (info.isFile()) row.sha = createHash('sha256').update(await readFile(path)).digest('hex');
    rows.push(row);
    if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await walk(join(path, name));
  };
  await walk(root);
  return rows;
}
async function command(argv) {
  const out = [], err = [];
  const code = await cli(argv, { out: { write: value => out.push(value) }, err: { write: value => err.push(value) } });
  return { code, output: out.length ? JSON.parse(out.join('')) : null, err: err.join('') };
}

try {
  const configPath = join(directory, 'test-kit.config.json');
  const config = {
    schemaVersion: 1,
    sides: { local: { origin: `http://127.0.0.1:${site.address().port}` }, design: { kind: 'design', provider: 'files', root: `${DEFAULT_STORE}/${STORE_INPUTS}/design` } },
    targets: [{ id: 'home', kind: 'page', path: '/', design: { small: 'home/small.png' } }],
    viewports: [{ id: 'small', width: 300, height: 200 }],
  };
  await writeFile(configPath, JSON.stringify(config));
  // Project inputs: a supplied design image, a crop an agent made, a nested note, and a link that leaves the design root.
  await mkdir(join(inputs, 'design', 'home'), { recursive: true });
  await mkdir(join(inputs, 'crops', 'home'), { recursive: true });
  await writeFile(join(inputs, 'design', 'home', 'small.png'), png());
  await writeFile(join(inputs, 'crops', 'home', 'header.png'), png());
  await writeFile(join(inputs, 'notes.txt'), 'kept by the project\n');
  await writeFile(join(directory, 'outside.png'), png());
  await symlink('../../../outside.png', join(inputs, 'design', 'escape.png'));
  const past = new Date('2020-01-01T00:00:00Z');
  for (const path of ['design/home/small.png', 'crops/home/header.png', 'notes.txt', 'design/home', 'crops/home', 'crops', 'design', '.']) await utimes(join(inputs, path), past, past);
  const seeded = await snapshot();
  const unchanged = async step => assert.deepEqual(await snapshot(), seeded, `${step} leaves ${STORE_INPUTS}/ unchanged.`);

  const steps = [
    ['run', ['run', '--config', configPath]],
    ['before', ['before', '--config', configPath]],
    ['after', ['after', '--config', configPath]],
    ['report --export', ['report', '--config', configPath, '--export', 'out/report']],
    ['capture', ['capture', '--side', 'local', '--config', configPath]],
    ['import', ['import', '--side', 'design', '--config', configPath]],
    ['history --publish', ['history', '--config', configPath, '--publish', 'out/published']],
    ['history --prune', ['history', '--config', configPath, '--prune']],
    ['history --prune --yes', ['history', '--config', configPath, '--prune', '--keep', '1', '--yes']],
  ];
  const results = {};
  for (const [name, argv] of steps) {
    const result = await command(argv);
    assert.equal(result.code, 0, `${name} succeeds: ${result.err}`);
    results[name] = result.output;
    await unchanged(name);
  }
  await refreshStoreViewer({ store: join(directory, DEFAULT_STORE) });
  await unchanged('a viewer refresh');

  // The viewer, the publish copy and the prune listing do not name inputs/.
  const index = await readFile(join(directory, DEFAULT_STORE, 'index.json'), 'utf8');
  assert.ok(!index.includes(STORE_INPUTS), 'index.json does not list inputs/.');
  assert.ok(!(await readdir(join(directory, 'out', 'published'))).includes(STORE_INPUTS), 'history --publish does not copy inputs/.');
  assert.ok(!JSON.stringify(results['history --prune']).includes(STORE_INPUTS), 'The prune listing does not name inputs/.');
  assert.ok(results['history --prune --yes'].removed.length > 0, 'The prune removed runs, so it ran on this store.');
  assert.ok(results.import.images === 1, 'import reads the design image under inputs/.');

  // R5.5: a root under inputs/ keeps every root-escape check.
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'home', kind: 'page', path: '/', design: { small: 'escape.png' } }] }));
  const escaped = await command(['import', '--side', 'design', '--config', configPath]);
  assert.equal(escaped.code, 1);
  assert.match(escaped.err, /escapes its root: escape\.png/);
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'home', kind: 'page', path: '/', design: { small: '../crops/home/header.png' } }] }));
  const dotted = await command(['import', '--side', 'design', '--config', configPath]);
  assert.equal(dotted.code, 1);
  assert.match(dotted.err, /plain relative path/);
  await unchanged('a refused import');
  console.log(`Store inputs: ${steps.length} commands and a viewer refresh leave ${STORE_INPUTS}/ unchanged; a design root under it imports and refuses an escape.`);
} finally {
  site.close(); await rm(directory, { recursive: true, force: true });
}
