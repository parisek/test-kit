import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptReport } from '../../src/report/model.js';
import { exportReport } from '../../src/export/report.js';
const root = await mkdtemp(join(tmpdir(), 'test-kit-export-check-'));
try {
 const input = join(root, 'input'); await mkdir(input);
 const report = { schemaVersion: 2, meta: { viewports: [{ id: 'wide' }], matchBelow: 3 }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, entries: [{ id: 'home', viewports: [{ id: 'wide', ratio: 0, artifacts: { screenshot: { a: { src: 'shot.php.png' }, diff: { ratio: 0 } }, html: { state: 'missing', a: { src: 'page.php.txt' } }, lighthouse: { state: 'missing', a: { reports: [{ html: { src: 'audit.php.html' }, json: { src: 'audit.php.json' } }] } } } }] }], findings: [], causes: [], rules: {} };
 await writeFile(join(input, 'report.json'), JSON.stringify(report));
 for (const [name, data] of [['shot.php.png', 'PNG'], ['page.php.txt', '<script>bad()</script>'], ['audit.php.html', '<script>audit()</script>'], ['audit.php.json', '{"raw":true}'], ['secret.txt', 'PRIVATE']]) await writeFile(join(input, name), data);
 const destination = join(root, 'export');
 const result = await exportReport({ reportPath: join(input, 'report.json'), outputDir: destination });
 for (const path of Object.values(result.paths)) assert.match(path, /^evidence\/[a-f0-9]{64}\.(png|txt|json|html\.txt)$/);
 const exported = JSON.parse(await readFile(join(destination, 'report.json'))); assert.equal(exported.entries[0].viewports[0].artifacts.html.a.src, result.paths['page.php.txt']);
 assert.equal(await readFile(join(destination, result.paths['page.php.txt']), 'utf8'), '<script>bad()</script>');
 assert(!result.files.some(path => path.includes('secret')));
 await assert.rejects(exportReport({ reportPath: join(input, 'report.json'), outputDir: destination }), /already exists/);
 const legacy = { meta: { viewports: [{ id: 'wide' }] }, entries: [{ id: 'home', title: 'shot.php.png', viewports: [{ id: 'wide', ratio: 0, shots: { target: 'shot.php.png', render: 'shot.php.png', diff: 'shot.php.png' } }] }] };
 await writeFile(join(input, 'legacy.json'), JSON.stringify(legacy));
 const legacyResult = await exportReport({ reportPath: join(input, 'legacy.json'), outputDir: join(root, 'legacy-export') });
 const legacyExport = JSON.parse(await readFile(join(legacyResult.outputPath, 'report.json')));
 assert.equal(legacyExport.schemaVersion, undefined); assert.equal(legacyExport.entries[0].title, 'shot.php.png');
 const legacyArtifact = adaptReport(legacyExport).entries[0].viewports[0].artifacts.screenshot;
 for (const side of ['a', 'b', 'diff']) {
  assert.equal(legacyArtifact[side].src, legacyResult.paths['shot.php.png']);
  assert.equal(await readFile(join(legacyResult.outputPath, legacyArtifact[side].src), 'utf8'), 'PNG');
 }
 await rm(join(input, 'shot.php.png')); await symlink(join(root, 'outside.png'), join(input, 'shot.php.png')); await writeFile(join(root, 'outside.png'), 'PRIVATE');
 await assert.rejects(exportReport({ reportPath: join(input, 'report.json'), outputDir: join(root, 'escaped') }), /escapes report root/);
 assert(!(await readdir(root)).includes('escaped'));
 console.log('Export guards pass: allowlist, safe names, inert HTML, no overwrite, symlink escape, and legacy screenshot references.');
} finally { await rm(root, { recursive: true, force: true }); }
