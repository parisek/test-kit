import { artifactState } from './state.js';
import { statusDetail } from './schema.js';
import { open, realpath, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { relativePath } from '../report/safe.js';
import { MAX_RESPONSE_BYTES } from './response.js';
import { settingsHash } from '../config/settings.js';
import { lineWindow } from './diff.js';

export async function readSidecar(root, path, maxBytes = MAX_RESPONSE_BYTES) {
  if (!relativePath(path)) throw new Error('Unsafe sidecar path.');
  const base = await realpath(root), file = await realpath(resolve(base, path));
  const offset = relative(base, file);
  if (!offset || offset.startsWith('..') || offset.startsWith('/')) throw new Error('Sidecar escapes its root.');
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('Sidecar exceeds the size limit.');
    const bytes = Buffer.alloc(info.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count !== info.size) throw new Error('Sidecar changes during reading.');
    return bytes.subarray(0, count);
  } finally { await handle.close(); }
}


export async function compareResponseArtifact({ kind, a, b, ac, bc, runsRoot, output, targetId, viewportId }) {
  const indexes = [ac?.artifacts?.[kind], bc?.artifacts?.[kind]];
  const result = { kind, state: artifactState(...indexes), a: null, b: null, diff: null };
  const viewportSettings = run => run.settings.viewports.map(({ id, width, height, deviceScaleFactor = 1 }) => ({ id, width, height, deviceScaleFactor }));
  if (result.state === 'complete' && (settingsHash(viewportSettings(a)) !== settingsHash(viewportSettings(b))
    || settingsHash(a.captureSettings?.browser ?? null) !== settingsHash(b.captureSettings?.browser ?? null))) {
    result.state = 'incompatible';
  }
  const bytes = [];
  for (const [index, run, side] of [[indexes[0], a, 'a'], [indexes[1], b, 'b']]) {
    if (index?.state !== 'captured') { bytes.push(null); continue; }
    try {
      const body = await readSidecar(join(runsRoot, run.id), index.path);
      if (kind === 'status') {
        statusDetail(JSON.parse(body));
      }
      const src = `runs/${run.id}/${index.path}`;
      await mkdir(dirname(join(output, src)), { recursive: true });
      await writeFile(join(output, src), body);
      result[side] = { kind, src, tool: index.tool, version: index.version,
        settingsHash: index.settingsHash, browserVersion: index.browserVersion, bytes: body.length,
        ...(kind === 'html' ? { contentType: typeof index.contentType === 'string' ? index.contentType.slice(0, 200) : 'unknown' } : {}) };
      bytes.push(body);
    } catch {
      result.state = 'failed'; result.diagnostic = 'Artifact sidecar is missing, invalid, or exceeds its limit.';
      bytes.push(null);
    }
  }
  if (result.state === 'complete' && bytes.every(Boolean)) {
    let detail;
    if (kind === 'html') {
      try {
        for (const index of indexes) {
          const charset = /charset=["']?([^;"'\s]+)/i.exec(index.contentType ?? '')?.[1];
          if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset.toLowerCase())) throw new Error('Unsupported charset.');
        }
        const decoder = new TextDecoder('utf-8', { fatal: true });
        detail = { changed: !bytes[0].equals(bytes[1]), ...lineWindow(decoder.decode(bytes[0]), decoder.decode(bytes[1])) };
      } catch {
        result.state = 'failed'; result.diagnostic = 'HTML response is not supported UTF-8 text.';
        return result;
      }
    } else {
      const before = statusDetail(JSON.parse(bytes[0])), after = statusDetail(JSON.parse(bytes[1]));
      detail = { changed: JSON.stringify(before) !== JSON.stringify(after), a: before, b: after };
    }
    const changed = detail.changed;
    const src = `diff/${kind}/${targetId}/${viewportId}.json`;
    await mkdir(dirname(join(output, src)), { recursive: true });
    await writeFile(join(output, src), JSON.stringify(detail));
    result.diff = { kind, src, tool: 'test-kit-response', version: '1',
      settingsHash: settingsHash({ mode: 'response-window', version: 1, maxLines: 100, maxLineLength: 2000 }), changed,
      ...(kind === 'html' ? { removedLines: detail.removedLines, addedLines: detail.addedLines, omittedLines: detail.omittedLines } : {}) };
  } else result.diagnostic ??= result.state === 'incompatible' ? 'Artifact settings or tool versions differ.' : 'Requested artifact evidence is incomplete.';
  return result;
}
