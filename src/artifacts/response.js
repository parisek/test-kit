import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function storeResponse({ response, requested, runDir, targetId, viewportId, provenance, assets, active = () => true, artifacts = {} }) {
  for (const kind of requested.filter(kind => ['html', 'status'].includes(kind))) {
    if (!active()) break;
    const index = { kind, ...provenance[kind] };
    try {
      let bytes;
      if (kind === 'html') {
        const declared = Number(response.headers()['content-length']);
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('Response exceeds 2 MiB.');
        bytes = await response.body();
        if (bytes.length > MAX_RESPONSE_BYTES) throw new Error('Response exceeds 2 MiB.');
        index.contentType = (response.headers()['content-type'] ?? 'unknown').slice(0, 200);
      } else {
        const redirects = [];
        let request = response.request();
        while (request.redirectedFrom()) {
          request = request.redirectedFrom();
          if (redirects.length >= 20) throw new Error('Redirect chain exceeds 20 steps.');
          redirects.unshift(new URL(request.url()).pathname.slice(0, 2000));
        }
        bytes = Buffer.from(JSON.stringify({ statusCode: response.status(),
          finalPath: new URL(response.url()).pathname.slice(0, 2000), redirects,
          assets: { requests: assets.requests, failed: assets.failed, httpErrors: assets.httpErrors } }));
      }
      const path = `${kind}/${targetId}/${viewportId}.${kind === 'html' ? 'txt' : 'json'}`;
      await mkdir(dirname(join(runDir, path)), { recursive: true });
      if (!active()) throw new Error('Capture deadline exceeded.');
      await writeFile(join(runDir, path), bytes, { mode: 0o600 });
      if (!active()) { await unlink(join(runDir, path)).catch(() => {}); throw new Error('Capture deadline exceeded.'); }
      artifacts[kind] = { ...index, state: 'captured', path, bytes: bytes.length };
    } catch {
      if (!active()) break;
      artifacts[kind] = { ...index, state: 'failed', error: { code: 'RESPONSE_ARTIFACT_FAILED', message: 'Response artifact is unavailable or exceeds its limit.' } };
    }
  }
  return artifacts;
}
