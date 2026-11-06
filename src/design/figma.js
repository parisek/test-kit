// The network part of the `figma` provider (R4.6, R5.5). It runs only during `import`.
// It talks to the Figma API and to its image storage, and to nothing else.
// The token goes in one header to the API. It never goes to the image storage, a log, an error or a file.
import { FIGMA_API_BASE, FIGMA_TOKEN_ENV, tokenProblem, imageUrlProblem as defaultImageUrlProblem } from './figma-ids.js';
import { MAX_DESIGN_BYTES } from './png.js';

export const API_TIMEOUT_MS = 30_000;
export const IMAGE_TIMEOUT_MS = 60_000;
export const IMPORT_DEADLINE_MS = 10 * 60_000;
export const MAX_API_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_IMAGES = 100;
export const IDS_PER_REQUEST = 50;

export class FigmaError extends Error {
  constructor(code, message) { super(message); this.name = 'FigmaError'; this.code = code; }
}

// The token comes from the environment only. A missing token fails before any request.
export function readToken(env) {
  const token = env?.[FIGMA_TOKEN_ENV];
  if (token === undefined || token === '') throw new FigmaError('FIGMA_TOKEN_MISSING', `The figma provider needs the access token in the environment variable ${FIGMA_TOKEN_ENV}. Set it and run import again. No request was made.`);
  const problem = tokenProblem(token);
  if (problem) throw new FigmaError('FIGMA_TOKEN_INVALID', `${FIGMA_TOKEN_ENV} ${problem}. No request was made.`);
  return token;
}

// Text from the network goes into an error only after this: the token is removed, control characters are removed, the length is bounded.
function clean(text, token) {
  let value = String(text ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
  if (token) value = value.split(token).join('[token]');
  return value.slice(0, 100);
}

// Read a body with a hard byte limit. The limit holds while the bytes arrive, not after.
async function readBounded(response, limit, what) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new FigmaError('FIGMA_TOO_LARGE', `${what} exceeds the size limit of ${limit} bytes.`);
  const chunks = [];
  let size = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new FigmaError('FIGMA_TOO_LARGE', `${what} exceeds the size limit of ${limit} bytes.`); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// One request. No redirect is followed: a redirect could send the request to a host the policy did not check.
// No retry: a rate limit (429) fails with the Retry-After value, and the person runs import again.
async function request(fetchImpl, url, { headers, timeoutMs, token, what, deadline }) {
  // One clock for the whole import: a request never runs past the deadline (R5.5).
  assertTime(deadline);
  timeoutMs = Math.max(1, Math.min(timeoutMs, deadline - Date.now()));
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new FigmaError(timeout ? 'FIGMA_TIMEOUT' : 'FIGMA_NETWORK', timeout ? `${what} timed out (limit ${timeoutMs} ms).` : `${what} failed (${clean(error?.cause?.code ?? error?.code ?? 'network error', token)}).`);
  }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel?.().catch(() => {}); throw new FigmaError('FIGMA_REDIRECT', `${what} answered with a redirect (${response.status}). The import does not follow redirects.`); }
  return response;
}

async function apiJson(fetchImpl, url, token, deadline, timeoutMs) {
  const response = await request(fetchImpl, url, { headers: { 'X-Figma-Token': token, Accept: 'application/json' }, timeoutMs, token, deadline, what: 'The Figma API request' });
  const bytes = await readBounded(response, MAX_API_BYTES, 'The Figma API response').catch(error => {
    if (error instanceof FigmaError) throw error;
    throw new FigmaError('FIGMA_NETWORK', 'The Figma API response could not be read.');
  });
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { body = null; }
  if (!response.ok) {
    const hint = response.status === 429 ? ` Retry after ${clean(response.headers.get('retry-after'), token)} s.` : '';
    const reason = body && typeof body === 'object' && typeof body.err === 'string' ? ` (${clean(body.err, token)})` : '';
    throw new FigmaError('FIGMA_HTTP', `The Figma API answered ${response.status}${reason}.${hint}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FigmaError('FIGMA_RESPONSE', 'The Figma API answered with data that is not an object.');
  if (body.err) throw new FigmaError('FIGMA_RESPONSE', `The Figma API reported an error (${clean(body.err, token)}).`);
  return body;
}

function assertTime(deadline) {
  if (Date.now() > deadline) throw new FigmaError('FIGMA_TIMEOUT', 'The import ran past its time limit and stopped.');
}

// Download the image of each `{ nodeId, scale }`. Returns a Map keyed by `${scale}|${nodeId}` to the PNG bytes.
// All-or-nothing: one failure throws and the caller writes no run. Test hooks (`apiBase`, `fetchImpl`, `imageUrlProblem`)
// and the two timeouts come from the caller of `importDesign` in a test. The command line and the configuration cannot set them.
export async function downloadFigmaImages({ fileKey, requests, token, apiBase = FIGMA_API_BASE, fetchImpl = globalThis.fetch, imageUrlProblem = defaultImageUrlProblem, apiTimeoutMs = API_TIMEOUT_MS, imageTimeoutMs = IMAGE_TIMEOUT_MS, deadlineMs = IMPORT_DEADLINE_MS, maxTotalBytes = MAX_TOTAL_BYTES }) {
  const deadline = Date.now() + deadlineMs;
  const unique = [...new Map(requests.map(item => [`${item.scale}|${item.nodeId}`, item])).values()];
  if (unique.length > MAX_IMAGES) throw new FigmaError('FIGMA_TOO_MANY', `The import would download ${unique.length} images. The limit is ${MAX_IMAGES}. Select fewer with --target or --viewport.`);
  const byScale = new Map();
  for (const item of unique) byScale.set(item.scale, [...(byScale.get(item.scale) ?? []), item.nodeId]);
  const result = new Map();
  let total = 0;
  for (const [scale, ids] of byScale) {
    for (let at = 0; at < ids.length; at += IDS_PER_REQUEST) {
      const batch = ids.slice(at, at + IDS_PER_REQUEST);
      const url = `${apiBase}/v1/images/${fileKey}?ids=${encodeURIComponent(batch.join(','))}&format=png&scale=${encodeURIComponent(String(scale))}`;
      const body = await apiJson(fetchImpl, url, token, deadline, apiTimeoutMs);
      const images = body.images && typeof body.images === 'object' && !Array.isArray(body.images) ? body.images : null;
      if (!images) throw new FigmaError('FIGMA_RESPONSE', 'The Figma API answered without an images map.');
      for (const nodeId of batch) {
        const link = Object.hasOwn(images, nodeId) ? images[nodeId] : undefined;
        if (typeof link !== 'string') throw new FigmaError('FIGMA_RESPONSE', `Figma rendered no image for node ${nodeId}. Check the node ID and that the token can read the file.`);
        const problem = imageUrlProblem(link);
        if (problem) throw new FigmaError('FIGMA_IMAGE_URL', `The image URL for node ${nodeId} ${problem}. The import refuses it.`);
        // No token and no cookie go to the image storage.
        const response = await request(fetchImpl, link, { headers: { Accept: 'image/png' }, timeoutMs: imageTimeoutMs, token, deadline, what: `The image download for node ${nodeId}` });
        if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw new FigmaError('FIGMA_HTTP', `The image download for node ${nodeId} answered ${response.status}.`); }
        const bytes = await readBounded(response, MAX_DESIGN_BYTES, `The image for node ${nodeId}`).catch(error => {
          if (error instanceof FigmaError) throw error;
          throw new FigmaError('FIGMA_NETWORK', `The image download for node ${nodeId} failed.`);
        });
        total += bytes.length;
        if (total > maxTotalBytes) throw new FigmaError('FIGMA_TOO_LARGE', `The images together exceed ${maxTotalBytes} bytes.`);
        result.set(`${scale}|${nodeId}`, bytes);
      }
    }
  }
  return result;
}
