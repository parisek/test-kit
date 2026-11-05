export function isLocalUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]'
    || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) || host.endsWith('.ddev.site');
}

export function createRunId(date, pid, sha) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isInteger(pid) || pid < 1 || !/^[a-f0-9]{7,40}$/.test(sha)) throw new Error('Invalid run identity');
  return `${date.toISOString().replace(/[:.]/g, '-')}-${pid}-${sha}`;
}

export function assertImageBounds(width, height, deviceScaleFactor = 1) {
  if (![width, height, deviceScaleFactor].every(value => Number.isFinite(value) && value > 0)
    || height > 30000 || Math.ceil(width * deviceScaleFactor) * Math.ceil(height * deviceScaleFactor) > 40_000_000) {
    throw new Error('Screenshot exceeds the height or pixel limit');
  }
}

export function targetPath(target, side) {
  return target.paths && Object.hasOwn(target.paths, side) ? target.paths[side] : target.path;
}

export function ddevMatchesOrigin(description, origin) {
  const raw = description?.raw;
  if (!raw || typeof raw !== 'object') return false;
  const expected = new URL(origin).hostname;
  return ['primary_url', 'httpurl', 'httpsurl'].some(key => {
    try { return typeof raw[key] === 'string' && new URL(raw[key]).hostname === expected; }
    catch { return false; }
  });
}

// Return null when DDEV reports the project as running.
// Return a message for any other status. A stopped project still describes
// its URLs, but the router answers 404 on every page.
export function ddevStatusProblem(description) {
  const status = description?.raw?.status;
  if (status === 'running') return null;
  const shown = typeof status === 'string' && /^[\w .-]{1,40}$/.test(status) ? ` (status: ${status})` : '';
  return `The DDEV project is not running${shown}. Run ddev start.`;
}

export function isOwnOrigin(value, origin) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  return url.origin === origin;
}

// Decide what a capture does with one request.
// allow: let it through. block: fail the capture. drop: abort it, keep the capture.
// A local side allows local GET and HEAD and blocks the rest (R3.10: `thirdParty: "drop"` drops a frame or
// subresource of another origin).
// A remote side blocks every method except GET and HEAD, to any origin: an
// attempted write is a finding, not noise. It allows GET and HEAD to its own
// origin and drops a GET or HEAD to another origin (a frame or a subresource).
// A top-level navigation to another origin fails the capture.
// R3.5: a remote side with `challenge: 'cloudflare'` also allows a POST that is not a
// navigation (fetch, XHR, beacon) to the challenge path of its own origin.
// R3.10: a side with `thirdParty` set to "drop" drops, and with "block" blocks, a GET or HEAD frame or
// subresource of another origin. Unset keeps the default of the side. A top-level navigation and every
// non-read method still block.
// R3.9: a side (local or remote) with `allowOrigins` also allows a GET or HEAD subresource of a
// named origin, when the resource type is in the list of that origin. A navigation never qualifies.
export function requestPolicy({ url, method, topLevel, navigation = topLevel, resourceType, origin, remote, challenge, allowOrigins, thirdParty }) {
  const read = ['GET', 'HEAD'].includes(method);
  // R3.10: the mode for a GET or HEAD frame or subresource of another origin. A local side blocks it
  // unless `thirdParty` is "drop". A remote side drops it unless `thirdParty` is "block".
  const drop = thirdParty === 'drop' || (remote && thirdParty !== 'block');
  const other = topLevel || !drop ? 'block' : 'drop';
  if (!remote) {
    if (!read) return 'block';
    return isLocalUrl(url) || (!navigation && isAllowedOriginRequest({ url, resourceType, allowOrigins })) ? 'allow' : other;
  }
  if (!read) return challenge === 'cloudflare' && isChallengeRequest({ url, method, navigation, origin }) ? 'allow' : 'block';
  if (isOwnOrigin(url, origin)) return 'allow';
  if (!navigation && isAllowedOriginRequest({ url, resourceType, allowOrigins })) return 'allow';
  return other;
}

// R3.8: the one entry of the request handler. It decides with requestPolicy and counts an
// aborted request that keeps the capture ('drop') in the log, so the two cannot drift apart.
export function decideRequest(log, args) {
  const decision = requestPolicy(args);
  if (decision === 'drop') recordDropped(log, { url: args.url, resourceType: args.resourceType });
  return decision;
}

// R3.9: the origin must match exactly: HTTPS, no credentials, same scheme, host and port.
// The resource type must be in the list of that entry. The list holds `stylesheet` and `font` only.
export const ALLOW_ORIGIN_TYPES = Object.freeze(['stylesheet', 'font']);
export function isAllowedOriginRequest({ url, resourceType, allowOrigins }) {
  if (!Array.isArray(allowOrigins) || typeof resourceType !== 'string' || !ALLOW_ORIGIN_TYPES.includes(resourceType)) return false;
  return allowOrigins.some(entry => entry && typeof entry.origin === 'string' && entry.origin.startsWith('https://')
    && Array.isArray(entry.types) && entry.types.includes(resourceType) && isOwnOrigin(url, entry.origin));
}

// R3.9: a redirect of a subresource may lead to an allowed origin, for the same resource type.
// A redirect of a navigation never does.
export function redirectToAllowedOrigin({ url, navigation, resourceType, allowOrigins }) {
  return !navigation && isAllowedOriginRequest({ url, resourceType, allowOrigins });
}

// R3.9: a redirect that starts at an allowed origin must end at an allowed origin for the same
// type. The own origin does not qualify: an origin that is not on the list fails the capture.
// Any other redirect keeps the rule of its side: the permitted URL, or an allowed origin.
export function redirectPermitted({ from, to, ownTarget, navigation, resourceType, allowOrigins }) {
  const target = redirectToAllowedOrigin({ url: to, navigation, resourceType, allowOrigins });
  if (!navigation && isAllowedOriginRequest({ url: from, resourceType, allowOrigins })) return target;
  return ownTarget || target;
}

// R3.7: name the first request the capture blocks, so a person can find the cause.
// Origin, method, resource type and kind only: no path, query string or fragment.
// The values come from the page, so the helper strips control characters and bounds each part.
// A subresource or a frame is not a navigation, and the text says which one it was.
function clean(value, max) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, max);
}
export function describeBlockedRequest({ url, method, resourceType, topLevel, navigation = topLevel, redirect = false, failure = null }) {
  let origin = 'unknown origin';
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'null') origin = parsed.origin;
    else if (parsed.protocol) origin = parsed.protocol;
  } catch { /* An unparsable URL stays unknown. */ }
  const kind = navigation ? (topLevel ? 'top-level navigation' : 'frame navigation') : 'subresource';
  return {
    origin: clean(origin, 100) || 'unknown origin',
    method: clean(method, 10).toUpperCase() || 'unknown',
    resourceType: clean(resourceType, 20) || 'unknown',
    kind, redirect: redirect === true, ...(failure ? { failure: clean(failure, 20) } : {}),
  };
}

export function blockedRequestMessage(blocked) {
  const base = 'A request leaves the local environment or submits data.';
  if (!blocked) return base;
  const { origin, method, resourceType, kind, redirect, failure } = blocked;
  // R3.9: a request to an allowed origin failed. The text names the origin, the type and the class of the error.
  if (failure) return `A request to an allowed origin (allowOrigins) failed (${failure}): ${origin}, ${resourceType}.`;
  return `${base} First blocked request: ${method} ${origin}, ${resourceType}, ${kind}${redirect ? ', redirect target' : ''}.`;
}

// The challenge path of Cloudflare JavaScript detection. Plain path characters only: no
// percent escape, so no encoded separator can reach another route after decoding.
const CLOUDFLARE_CHALLENGE = /^\/cdn-cgi\/challenge-platform\/[A-Za-z0-9._~:+=-]+(?:\/[A-Za-z0-9._~:+=-]+)*$/;
function isChallengeRequest({ url, method, navigation, origin }) {
  if (method !== 'POST' || navigation || !isOwnOrigin(url, origin)) return false;
  return CLOUDFLARE_CHALLENGE.test(new URL(url).pathname);
}

// R3.6: a sign that the edge in front of a remote side challenges or limits the capture.
// Cloudflare marks a challenge with `cf-mitigated`. A 403 or 429 on the page itself is a
// firewall block or a rate limit. More requests could turn it into a longer ban.
export function edgeStop({ status, headers, main }) {
  if (headers && Object.hasOwn(headers, 'cf-mitigated')) return `cf-mitigated: ${String(headers['cf-mitigated']).slice(0, 40)}`;
  if (main && (status === 403 || status === 429)) return `HTTP ${status}`;
  return null;
}

// R3.4: a remote side may name itself. Like the certificate option, the User-Agent stays out of
// the settings hash, and run.settings records it. Without the key, Playwright sends its default.
export function userAgentOption(side) {
  return side.remote === true && Object.hasOwn(side, 'userAgent') ? { userAgent: side.userAgent } : {};
}

// R3.8: count the requests a remote side aborts, per resource type and origin.
// The record keeps no path, query string or fragment. The page supplies the values,
// so the helpers strip control characters and bound each part and the list.
export const DROPPED_LIMIT = 50;
export function createDroppedLog() { return { counts: new Map(), omitted: 0 }; }
export function recordDropped(log, { url, resourceType }) {
  // Only an http(s) origin is a record. The reader drops the rest (data:, blob:), so they must not use a slot.
  let protocol = '';
  try { protocol = new URL(url).protocol; } catch { /* An unparsable URL is no record. */ }
  if (protocol !== 'http:' && protocol !== 'https:') return;
  const { origin, resourceType: type } = describeBlockedRequest({ url, method: 'GET', resourceType });
  const key = `${type}\n${origin}`;
  if (log.counts.has(key)) log.counts.set(key, log.counts.get(key) + 1);
  else if (log.counts.size < DROPPED_LIMIT) log.counts.set(key, 1);
  else log.omitted += 1;
}
// Return the fields to spread into a capture result. An empty log adds nothing.
export function droppedFields(log) {
  if (!log.counts.size && !log.omitted) return {};
  const dropped = [...log.counts].map(([key, count]) => {
    const [resourceType, origin] = key.split('\n');
    return { resourceType, origin, count };
  }).sort((a, b) => a.resourceType.localeCompare(b.resourceType) || a.origin.localeCompare(b.origin));
  return { dropped, ...(log.omitted ? { droppedOmitted: log.omitted } : {}) };
}

// R3.9: any failed fetch of an allowed origin fails the capture, so no page renders in a fallback font
// without a warning. The pattern only labels the message: it never decides whether the capture fails.
export function isCertificateError(error) {
  return /certificate|self[- ]signed|CERT_|unable to verify/i.test(String(error?.message ?? error));
}
export function allowedOriginFailure({ url, method, resourceType, allowOrigins, error }) {
  if (!isAllowedOriginRequest({ url, resourceType, allowOrigins })) return null;
  return describeBlockedRequest({ url, method, resourceType, topLevel: false, navigation: false, failure: isCertificateError(error) ? 'certificate' : 'request failed' });
}

// R3.9: an HTTP error answer of an allowed origin (below 200 or 400 and above) also fails the capture.
// A 2xx and a 3xx answer pass: a redirect keeps the rule of its own (redirectPermitted).
export function allowedOriginStatusFailure({ url, method, resourceType, allowOrigins, status }) {
  if (!isAllowedOriginRequest({ url, resourceType, allowOrigins })) return null;
  if (!Number.isInteger(status) || (status >= 200 && status < 400)) return null;
  return describeBlockedRequest({ url, method, resourceType, topLevel: false, navigation: false, failure: `HTTP ${status}` });
}
