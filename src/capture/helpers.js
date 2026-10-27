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

export function isOwnOrigin(value, origin) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  return url.origin === origin;
}

// Decide what a capture does with one request.
// allow: let it through. block: fail the capture. drop: abort it, keep the capture.
// A local side allows local GET and HEAD and blocks the rest.
// A remote side blocks every method except GET and HEAD, to any origin: an
// attempted write is a finding, not noise. It allows GET and HEAD to its own
// origin and drops a GET or HEAD to another origin (a frame or a subresource).
// A top-level navigation to another origin fails the capture.
// R3.5: a remote side with `challenge: 'cloudflare'` also allows a POST that is not a
// navigation (fetch, XHR, beacon) to the challenge path of its own origin.
export function requestPolicy({ url, method, topLevel, navigation = topLevel, origin, remote, challenge }) {
  const read = ['GET', 'HEAD'].includes(method);
  if (!remote) return read && isLocalUrl(url) ? 'allow' : 'block';
  if (!read) return challenge === 'cloudflare' && isChallengeRequest({ url, method, navigation, origin }) ? 'allow' : 'block';
  if (isOwnOrigin(url, origin)) return 'allow';
  return topLevel ? 'block' : 'drop';
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
