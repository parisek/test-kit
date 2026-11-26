import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validRegions, cropBox, markdownText, bundleMarkdown, pngPixels, CROP_MARGIN, CROP_LIMIT, REGION_LIMIT } from '../../src/export/bundle.js';
import { parseCommand } from '../../src/cli/run.js';

test('validRegions keeps whole-number boxes inside the canvas only (R11.10)', () => {
  const canvas = { width: 100, height: 50 };
  assert.deepEqual(validRegions([{ x: 1, y: 2, width: 3, height: 4, pixels: 5 }], canvas), [{ x: 1, y: 2, width: 3, height: 4, pixels: 5 }]);
  for (const bad of [{ x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: 99, y: 0, width: 2, height: 1 }, { x: 0.5, y: 0, width: 1, height: 1 }, { x: '1', y: 0, width: 1, height: 1 }, null]) assert.deepEqual(validRegions([bad], canvas), []);
  assert.deepEqual(validRegions('x', canvas), []);
});

test('cropBox takes the union of the regions plus a margin, inside the canvas and the size limit', () => {
  assert.deepEqual(cropBox([], { width: 40, height: 30 }), { x: 0, y: 0, width: 40, height: 30 });
  assert.deepEqual(cropBox([{ x: 100, y: 200, width: 10, height: 10 }, { x: 150, y: 210, width: 5, height: 40 }], { width: 1000, height: 1000 }),
    { x: 100 - CROP_MARGIN, y: 200 - CROP_MARGIN, width: 55 + 2 * CROP_MARGIN, height: 50 + 2 * CROP_MARGIN });
  assert.deepEqual(cropBox([{ x: 5, y: 5, width: 10, height: 10 }], { width: 20, height: 20 }), { x: 0, y: 0, width: 20, height: 20 });
  assert.deepEqual(cropBox([], { width: 3000, height: 9000 }), { x: 0, y: 0, width: CROP_LIMIT, height: CROP_LIMIT, truncated: true });
  // A union larger than the limit is centered on the largest region, on that axis only (R11.10).
  assert.deepEqual(cropBox([{ x: 100, y: 100, width: 10, height: 10 }, { x: 5000, y: 50, width: 20, height: 10 }], { width: 10000, height: 6000 }),
    { x: 5010 - CROP_LIMIT / 2, y: 26, width: CROP_LIMIT, height: 108, truncated: true });
  // The case of the review: regions in two far corners of a 3000 × 4000 page. The crop holds the larger one.
  const far = [{ x: 2950, y: 10, width: 40, height: 40 }, { x: 5, y: 3500, width: 10, height: 10 }];
  const box = cropBox(far, { width: 3000, height: 4000 });
  assert.deepEqual(box, { x: 600, y: 0, width: CROP_LIMIT, height: CROP_LIMIT, truncated: true });
  assert.ok(box.x <= 2950 && 2990 <= box.x + box.width && box.y <= 10 && 50 <= box.y + box.height, 'the largest region is inside the crop');
  // Near the edge, the crop stays inside the canvas.
  assert.deepEqual(cropBox([{ x: 0, y: 0, width: 5, height: 5 }, { x: 0, y: 5000, width: 1, height: 1 }], { width: 100, height: 6000 }), { x: 0, y: 0, width: 5 + CROP_MARGIN, height: CROP_LIMIT, truncated: true });
});

// A PNG of `chunks`, each [type, data]. The CRC is not checked here, so it is zero.
const pngOf = chunks => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks.map(([type, data]) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
})]);
const ihdr = (width, height) => { const data = Buffer.alloc(13); data.writeUInt32BE(width, 0); data.writeUInt32BE(height, 4); data[8] = 8; data[9] = 6; return ['IHDR', data]; };

test('pngPixels reads the size from the one IHDR chunk and refuses a second one (R11.10)', () => {
  assert.equal(pngPixels(pngOf([ihdr(20, 30), ['IDAT', Buffer.alloc(4)], ['IEND', Buffer.alloc(0)]])), 600);
  // A small first header and a large second one: a decoder can allocate by the second.
  assert.throws(() => pngPixels(pngOf([ihdr(2, 2), ihdr(20000, 20000), ['IEND', Buffer.alloc(0)]])), /more than one IHDR/);
  assert.throws(() => pngPixels(pngOf([['tEXt', Buffer.alloc(13)], ihdr(2, 2)])), /start with one IHDR/);
  assert.throws(() => pngPixels(Buffer.from('not a png, but long enough to read the header')), /not a PNG/);
  assert.throws(() => pngPixels('x'), /not a PNG/);
});

test('markdownText keeps report text plain', () => {
  assert.equal(markdownText('a\n# b [x](http://e) ![i](y) `c` <b>'), 'a \\# b \\[x\\]\\(http\\://e\\) \\!\\[i\\]\\(y\\) \\`c\\` \\<b\\>');
  // No autolink of GitHub-flavored Markdown: a bare URL, a www. name and an e-mail address.
  assert.equal(markdownText('https://e.example www.e.example a@e.example'), 'https\\://e\\.example www\\.e\\.example a\\@e\\.example');
  // C1 controls and direction controls become spaces.
  assert.equal(markdownText('a\u202eb\u0085c\u2066d'), 'a b c d');
  assert.equal(markdownText(42), '');
  assert.equal(markdownText('x'.repeat(600)).length, 500);
});

test('bundleMarkdown names the finding, the pair and the images', () => {
  const record = { finding: { id: 'home-desktop', targetId: 'home', viewportId: 'desktop', artifact: 'screenshot', message: 'Screenshot pixels differ.', class: 'unexplained' },
    report: { pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' } }, crop: { x: 0, y: 4, width: 40, height: 20 }, regions: [{}], regionsOmitted: 2, images: { a: 'a.png', b: 'b.png', diff: 'diff.png' } };
  const text = bundleMarkdown(record);
  assert.match(text, /^# Screenshot pixels differ\\\.\n/);
  for (const line of ['- Target: home', '- Viewport: desktop', '- Class: unexplained', '- Pair: update, run A run\\-a, run B run\\-b', '- diff.png: the difference', '- Crop: x 0, y 4, 40 × 20 px of the full screenshot', '- Regions: 1 in finding.json, 2 more not listed']) assert.ok(text.includes(line), line);
  assert.ok(bundleMarkdown({ ...record, regions: [], regionsInvalid: 3 }).includes('- Regions: 0 in finding.json, 2 more not listed, 3 invalid in the report'));
  const plain = bundleMarkdown({ ...record, crop: null, regions: [], regionsOmitted: 0, images: {}, finding: { ...record.finding, artifact: 'html', viewportId: null } });
  assert.equal(plain.includes('## Images'), false);
  assert.equal(plain.includes('Viewport'), false);
});

test('bundle takes one report, --finding and --output', () => {
  assert.deepEqual(parseCommand(['bundle', 'report.json', '--finding', 'home-desktop', '--output', 'out']).options, { finding: 'home-desktop', output: 'out' });
  assert.throws(() => parseCommand(['bundle', 'report.json', '--output', 'out']), /--finding and --output together/);
  assert.throws(() => parseCommand(['bundle', 'report.json', '--finding', 'x']), /--finding and --output together/);
  assert.deepEqual(parseCommand(['bundle', 'report.json']).options, {});
  assert.throws(() => parseCommand(['bundle', '--finding', 'x', '--output', 'out']), /positional/);
  assert.throws(() => parseCommand(['bundle', 'report.json', '--finding', 'x', '--output', 'out', '--target', 'home']), /Unknown option/);
});

// writeBundle and compareRuns load pngjs. The plain unit job installs no dependency, so it skips this test.
const tools = await Promise.all([import('pngjs'), import('pixelmatch'), import('../../src/compare/runs.js'), import('../../src/config/index.js'), import('../../src/config/settings.js'), import('../../src/export/bundle.js')]).catch(() => null);
test('writeBundle writes the crops, finding.json and finding.md of one finding (R11.10, #149)', { skip: !tools && 'pngjs or pixelmatch is not installed' }, async () => {
  const [{ PNG }, , { compareRuns }, { normalizeConfig, settingsHash }, { screenshotScope, settleRecipe }, { writeBundle, listFindings }] = tools;
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-bundle-'));
  try {
    const config = normalizeConfig({ schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } }, targets: [{ id: 'home', kind: 'page', path: '/' }],
      viewports: [{ id: 'desktop', width: 200, height: 150 }], runsRoot: 'runs' });
    // A white page. Run B has a red block at x 120..139, y 90..99.
    const png = red => { const image = new PNG({ width: 200, height: 150 }); image.data.fill(255);
      if (red) for (let y = 90; y < 100; y++) for (let x = 120; x < 140; x++) { const i = (y * 200 + x) * 4; image.data[i + 1] = 0; image.data[i + 2] = 0; }
      return PNG.sync.write(image); };
    const fake = async (id, red) => {
      const runDir = join(dir, 'runs', id), path = 'screenshots/home/desktop.png';
      await mkdir(join(runDir, 'screenshots', 'home'), { recursive: true });
      await writeFile(join(runDir, path), png(red));
      const row = config.targets[0];
      await writeFile(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 2, id, side: 'local', label: id, at: '2026-11-25T10:00:00.000Z', state: 'complete', settings: config, settingsHash: 'sha256:abc', captureSettings: {},
        tools: [{ name: 'playwright', version: '1.0.0', settingsHash: 'sha256:abc' }],
        captures: [{ targetId: 'home', viewportId: 'desktop', settleHash: settingsHash(settleRecipe(config, 'local', row)), scopeHash: settingsHash(screenshotScope(row, 'local')), state: 'captured', path, statusCode: 200, finalPath: '/', width: 200, height: 150, deviceScaleFactor: 1, artifacts: {} }] }));
    };
    const runA = '2026-11-25T10-00-00-000Z-1-aaaaaa1', runB = '2026-11-25T10-00-00-000Z-1-bbbbbb1';
    await fake(runA, false); await fake(runB, true);
    const { report, reportPath } = await compareRuns({ runsRoot: join(dir, 'runs'), runA, runB, outputDir: join(dir, 'report') });
    const finding = report.findings.find(item => item.artifact === 'screenshot');
    assert.deepEqual(await listFindings({ reportPath }), { findings: [{ id: finding.id, targetId: 'home', viewportId: 'desktop', artifact: 'screenshot', class: 'unexplained' }], findingsOmitted: 0 });
    const out = join(dir, 'bundles');
    const result = await writeBundle({ reportPath, findingId: finding.id, output: out });
    assert.equal(result.bundle, join(out, finding.id));
    assert.deepEqual(result.files, ['a.png', 'b.png', 'diff.png', 'finding.json', 'finding.md']);
    assert.deepEqual((await readdir(result.bundle)).sort(), result.files);
    const record = JSON.parse(await readFile(join(result.bundle, 'finding.json'), 'utf8'));
    assert.equal(record.schemaVersion, 1);
    assert.deepEqual(record.finding, { id: finding.id, targetId: 'home', viewportId: 'desktop', artifact: 'screenshot', message: 'Screenshot pixels differ.', class: 'unexplained' });
    assert.deepEqual(record.report.pair, { kind: report.pair.kind, aRunId: runA, bRunId: runB });
    assert.deepEqual(record.crop, { x: 120 - CROP_MARGIN, y: 90 - CROP_MARGIN, width: 20 + 2 * CROP_MARGIN, height: 10 + 2 * CROP_MARGIN });
    assert.deepEqual(record.regions.map(({ x, y, width, height }) => ({ x, y, width, height })), [{ x: 120, y: 90, width: 20, height: 10 }]);
    // The crop of B comes from the full-resolution original: its red block sits at the margin.
    const b = PNG.sync.read(await readFile(join(result.bundle, 'b.png')));
    assert.deepEqual([b.width, b.height], [record.crop.width, record.crop.height]);
    const at = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
    assert.deepEqual(at(b, CROP_MARGIN, CROP_MARGIN), [255, 0, 0]);
    assert.deepEqual(at(b, 0, 0), [255, 255, 255]);
    assert.deepEqual(at(PNG.sync.read(await readFile(join(result.bundle, 'a.png'))), CROP_MARGIN, CROP_MARGIN), [255, 255, 255]);
    assert.match(await readFile(join(result.bundle, 'finding.md'), 'utf8'), /^# Screenshot pixels differ\\\.\n[\s\S]*- a\.png: side A/);
    assert.equal(record.regionsInvalid, 0);
    // A bundle never replaces an earlier one.
    await assert.rejects(writeBundle({ reportPath, findingId: finding.id, output: out }), /exists/);
    await assert.rejects(writeBundle({ reportPath, findingId: 'missing', output: out }), /no finding missing/);
    await assert.rejects(writeBundle({ reportPath, findingId: '../x', output: out }), /--finding must be/);
    // Report data is untrusted: an image path outside the report folder fails, and nothing is written.
    const stored = JSON.parse(await readFile(reportPath, 'utf8'));
    stored.entries[0].viewports[0].artifacts.screenshot.a.src = '../runs/x.png';
    const tampered = join(dir, 'report', 'tampered.json');
    await writeFile(tampered, JSON.stringify(stored));
    await assert.rejects(writeBundle({ reportPath: tampered, findingId: finding.id, output: join(dir, 'other') }), /Unsafe (sidecar|artifact) path|escapes/);
    await assert.rejects(readdir(join(dir, 'other', finding.id)), { code: 'ENOENT' });
    // A finding of another artifact gets the text files only.
    stored.entries[0].viewports[0].artifacts.screenshot.a.src = report.entries[0].viewports[0].artifacts.screenshot.a.src;
    stored.findings = [{ ...finding, id: 'html-home-desktop', artifact: 'html', message: 'HTML response bytes differ.' }];
    await writeFile(tampered, JSON.stringify(stored));
    const html = await writeBundle({ reportPath: tampered, findingId: 'html-home-desktop', output: join(dir, 'other') });
    assert.deepEqual(html.files, ['finding.json', 'finding.md']);
    assert.equal(JSON.parse(await readFile(join(html.bundle, 'finding.json'), 'utf8')).crop, null);
    // At most REGION_LIMIT regions are listed. The rest are counted, and invalid ones apart.
    const many = JSON.parse(JSON.stringify(stored));
    many.findings = [finding];
    many.entries[0].viewports[0].artifacts.screenshot.diff.regions = [...Array.from({ length: REGION_LIMIT + 10 }, (_, i) => ({ x: i, y: 0, width: 1, height: 1 })), { x: -1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }];
    const manyPath = join(dir, 'report', 'many.json');
    await writeFile(manyPath, JSON.stringify(many));
    const listed = JSON.parse(await readFile(join((await writeBundle({ reportPath: manyPath, findingId: finding.id, output: join(dir, 'many') })).bundle, 'finding.json'), 'utf8'));
    assert.deepEqual([listed.regions.length, listed.regionsOmitted, listed.regionsInvalid], [REGION_LIMIT, 10, 2]);
    // A listed finding whose id is not a valid --finding value says so.
    many.findings = [finding, { ...finding, id: '../x' }];
    await writeFile(manyPath, JSON.stringify(many));
    assert.deepEqual((await listFindings({ reportPath: manyPath })).findings.map(item => item.bundle), [undefined, false]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bundle refuses an --output inside inputs/ of the default store before it reads the report (R12.6)', async () => {
  const { dispatch } = await import('../../src/cli/run.js');
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-bundle-inputs-'));
  try {
    const config = join(dir, 'test-kit.config.json');
    for (const output of [join(dir, 'test-kit', 'inputs'), join(dir, 'test-kit', 'inputs', 'bundles')]) {
      await assert.rejects(dispatch({ command: 'bundle', positions: [join(dir, 'missing.json')], options: { finding: 'x', output, config } }), /--output must not be inside inputs\//, output);
    }
    await assert.rejects(readdir(join(dir, 'test-kit')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
