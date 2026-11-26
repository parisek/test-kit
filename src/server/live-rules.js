// Pure rules of the live proxy (R10.18). No socket, no file system: `node --test` covers them (R4.4).

export const LIVE_SCRIPT_PATH = '/__test-kit/live.js';
export const HTML_LIMIT = 16 * 1024 * 1024;
export const STREAM_LIMIT = 64 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 30_000;
export const LIMITS = Object.freeze({ html: HTML_LIMIT, stream: STREAM_LIMIT, timeoutMs: REQUEST_TIMEOUT_MS });

// R10.18 item 3: the request target, as `serve` checks it.
export function badTarget(raw) {
  return typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000]/.test(raw);
}

// R10.18 item 3: the Host header must name this server exactly (DNS rebinding).
export function hostMatches(headers, port) {
  return headers.host === `127.0.0.1:${port}`;
}

// R10.18 item 3: a request from another web site. The report server lets a top-level navigation through.
export function crossSiteRefused(headers, { allowNavigation = false } = {}) {
  if (headers['sec-fetch-site'] !== 'cross-site') return false;
  if (allowNavigation && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document') return false;
  return true;
}

// R10.18 item 3: the status code for a request that a proxy refuses, or null.
export function proxyRefusal({ method, url, headers }, { port, sideOrigin }) {
  if (!hostMatches(headers, port)) return 400;
  if (crossSiteRefused(headers)) return 403;
  if (!['GET', 'HEAD'].includes(method)) return 405;
  if (badTarget(url)) return 400;
  let resolved;
  try { resolved = new URL(url, sideOrigin); } catch { return 400; }
  if (resolved.origin !== sideOrigin) return 400;
  if (Object.hasOwn(headers, 'service-worker')) return 403;
  return null;
}

// R10.18 item 4: the fixed list of request headers. Nothing else from the frame reaches the side.
export function forwardHeaders(headers, { sideOrigin, userAgent }) {
  const result = { host: new URL(sideOrigin).host, 'accept-encoding': 'identity' };
  for (const name of ['accept', 'accept-language']) if (typeof headers[name] === 'string') result[name] = headers[name];
  const agent = userAgent ?? headers['user-agent'];
  if (typeof agent === 'string') result['user-agent'] = agent;
  return result;
}

// Hop-by-hop headers (RFC 9110, section 7.6.1) and the headers that R10.18 item 5 drops.
const DROPPED = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'set-cookie', 'service-worker-allowed', 'x-frame-options', 'alt-svc', 'strict-transport-security']);

function withoutFrameAncestors(policy) {
  return policy.split(',').map(part => part.split(';').map(item => item.trim()).filter(item => item && !/^frame-ancestors(\s|$)/i.test(item)).join('; ')).filter(Boolean).join(', ');
}

// R10.18 item 5: a redirect to the side origin becomes a redirect to the proxy origin.
export function rewriteLocation(location, { sideOrigin, proxyOrigin, requestUrl }) {
  let url;
  try { url = new URL(location, new URL(requestUrl, sideOrigin)); } catch { return location; }
  if (url.origin !== sideOrigin) return location;
  return `${proxyOrigin}${url.pathname}${url.search}${url.hash}`;
}

// R10.18 item 5: the headers of the proxied response. `html` marks a body that gets the script.
export function responseHeaders(raw, { sideOrigin, proxyOrigin, viewerOrigin, requestUrl, html, clearStorage }) {
  const result = {};
  const policies = { 'content-security-policy': [], 'content-security-policy-report-only': [] };
  for (const [key, value] of Object.entries(raw)) {
    const name = key.toLowerCase();
    if (DROPPED.has(name) || value === undefined) continue;
    if (Object.hasOwn(policies, name)) { policies[name].push(...[value].flat()); continue; }
    if (html && name === 'content-length') continue;
    result[name] = name === 'location' ? rewriteLocation(String(value), { sideOrigin, proxyOrigin, requestUrl }) : value;
  }
  for (const [name, values] of Object.entries(policies)) {
    const kept = values.map(withoutFrameAncestors).filter(Boolean);
    if (name === 'content-security-policy' || kept.length) result[name] = [...kept, `frame-ancestors ${viewerOrigin}`];
  }
  if (clearStorage) result['clear-site-data'] = '"storage"';
  return result;
}

// R10.18 items 5 and 6: an HTML page. A status without a body (1xx, 204, 304) is not one.
export function isHtmlPage(statusCode, headers) {
  return !(statusCode < 200 || statusCode === 204 || statusCode === 304) && isHtml(headers);
}

export function isHtml(headers) {
  const type = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

export function plainBody(headers) {
  const encoding = String(headers['content-encoding'] ?? '').trim().toLowerCase();
  return encoding === '' || encoding === 'identity';
}

// R10.18 item 6: one script element after the opening `<head>` tag. Without one, after the `<html>` tag,
// else after the doctype, else after a byte order mark. The doctype stays first, so the page keeps
// its rendering mode.
export function injectScript(body) {
  const tag = Buffer.from(`<script src="${LIVE_SCRIPT_PATH}"></script>`);
  const text = body.toString('latin1');
  // Only the part before the first `<body` or `<script` counts, so a `<head>` string inside a script does not.
  const stop = text.search(/<(?:body|script)[\s>]/i);
  const start = stop === -1 ? text : text.slice(0, stop);
  const at = endOf(/<head(?:\s[^>]*)?>/i, start) ?? endOf(/<html(?:\s[^>]*)?>/i, start)
    ?? endOf(/^(?:\xef\xbb\xbf)?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i, text) ?? (text.startsWith('\xef\xbb\xbf') ? 3 : 0);
  return Buffer.concat([body.subarray(0, at), tag, body.subarray(at)]);
}

function endOf(pattern, text) {
  const match = pattern.exec(text);
  return match ? match.index + match[0].length : null;
}

// R10.18 item 6: the scroll script. The viewer origin is the only target and the only accepted sender.
export function liveScript(viewerOrigin) {
  const origin = JSON.stringify(viewerOrigin);
  return `(() => {
  const viewer = ${origin};
  if (window.parent === window) return;
  const ratio = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; window.parent.postMessage({ type: 'test-kit/live-scroll', ratio: ratio() }, viewer); });
  }, { passive: true });
  window.addEventListener('message', (event) => {
    if (event.origin !== viewer || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'test-kit/live-scroll-to' || typeof data.ratio !== 'number' || !Number.isFinite(data.ratio) || data.ratio < 0 || data.ratio > 1) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.round(max * data.ratio));
  });
  window.parent.postMessage({ type: 'test-kit/live-ready' }, viewer);
})();
`;
}

// R10.18 item 9: the lists of the Live page. A design side has no origin and no proxy (R5.5).
export function liveIndex(config, proxies) {
  const sides = Object.keys(config.sides).filter(id => Object.hasOwn(proxies, id)).map(id => ({ id, origin: proxies[id] }));
  const targets = config.targets.map(target => ({
    id: target.id,
    paths: Object.fromEntries(sides.map(({ id }) => [id, target.paths && Object.hasOwn(target.paths, id) ? target.paths[id] : (target.path ?? null)])),
  }));
  const viewports = config.viewports.map(({ id, width, height }) => ({ id, width, height }));
  return { sides, targets, viewports };
}
