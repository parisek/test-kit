import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function storeResponse({ response, origin = null, requested, runDir, targetId, viewportId, provenance, assets, active = () => true, artifacts = {} }) {
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
        // #348: the final origin, only when the page ends on another origin than the side origin.
        const final = new URL(response.url());
        const finalOrigin = finalOriginOf(final, origin);
        bytes = Buffer.from(JSON.stringify({ statusCode: response.status(),
          finalPath: final.pathname.slice(0, 2000), ...(finalOrigin ? { finalOrigin } : {}), redirects,
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

// #348: the origin where a page ends, only when it differs from the side origin. An origin
// over 200 characters is left out: a cut origin is not an origin (statusDetail). Pure (R4.4).
export function finalOriginOf(url, origin) {
  if (!origin) return null;
  const final = new URL(url);
  if (!/^https?:$/.test(final.protocol) || final.origin === new URL(origin).origin || final.origin.length > 200) return null;
  return final.origin;
}
