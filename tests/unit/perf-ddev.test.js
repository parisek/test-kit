import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDdev } from '../../src/cli/perf.js';

// A fake `ddev` on PATH. It prints one description and logs each call.
async function withFakeDdev(status, run) {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-ddev-'));
  const project = join(dir, 'project');
  await mkdir(join(project, '.ddev'), { recursive: true });
  await mkdir(join(dir, 'bin'));
  const description = JSON.stringify({ raw: { status, primary_url: 'https://example-site.ddev.site' } });
  await writeFile(join(dir, 'bin', 'ddev'), `#!/bin/sh\necho "$@" >> "${join(dir, 'calls.log')}"\n[ "$1" = describe ] && echo '${description}'\nexit 0\n`);
  await chmod(join(dir, 'bin', 'ddev'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${join(dir, 'bin')}:${saved}`;
  try { return await run(project, async () => readFile(join(dir, 'calls.log'), 'utf8').catch(() => '')); }
  finally { process.env.PATH = saved; await rm(dir, { recursive: true, force: true }); }
}

test('perf stops with a clear message when the DDEV project is stopped, before mutagen sync', async () => {
  await withFakeDdev('stopped', async (project, calls) => {
    await assert.rejects(verifyDdev(project, 'http://example-site.ddev.site'), /The DDEV project is not running \(status: stopped\)\. Run ddev start\./);
    assert.equal((await calls()).includes('mutagen'), false);
  });
});

test('perf keeps going when the DDEV project runs', async () => {
  await withFakeDdev('running', async (project, calls) => {
    await verifyDdev(project, 'http://example-site.ddev.site');
    assert.match(await calls(), /mutagen sync/);
  });
});
