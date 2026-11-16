// R6.16, R6.17: request isolation of a speed run without a proxy (#383).
// Pure functions: no browser, no network, no file system (R4.4).
//
// Chrome resolves every host to "not found", except the own host and the hosts of
// `allowOrigins`. A local side pins its own host to the loopback address that the
// runner checked before the launch, so DNS cannot move it later. Lighthouse blocks the
// block paths of the own origin by URL pattern. A blocked request is evidence, not a
// failure. The runner reads the request log of each audit with `requestEvidence`.

const MAX_GROUPS = 50;
const SAFE_HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/;

function host(origin) {
  const value = new URL(origin).hostname.toLowerCase();
  if (!SAFE_HOST.test(value)) throw new Error('Performance host is not a plain host name.');
  return value;
}

// The value of `--host-resolver-rules`. `address` is the checked loopback address of a
// local side, or null for a remote side.
export function hostResolverRules({ origin, address = null, allowOrigins = [] }) {
  const own = host(origin);
  const rules = [];
  if (address !== null) {
    const pinned = address.includes(':') ? `[${address}]` : address;
    if (!SAFE_HOST.test(pinned)) throw new Error('Performance address is invalid.');
    rules.push(`MAP ${own} ${pinned}`);
  }
  rules.push('MAP * ~NOTFOUND');
  // An exclusion skips every MAP rule, so a local own host gets none: its MAP rule comes first.
  const excluded = new Set(allowOrigins.map(host));
  if (address === null) excluded.add(own); else excluded.delete(own);
  for (const name of [...excluded].sort()) rules.push(`EXCLUDE ${name}`);
  return rules.join(', ');
}

// Lighthouse `blockedUrlPatterns` for the block paths of the own origin.
export function blockedUrlPatterns(origin, blockPaths = []) {
  const base = new URL(origin).origin;
  return blockPaths.map(path => `${base}${path}`);
}

const typeOf = value => (typeof value === 'string' && /^[A-Za-z]{1,40}$/.test(value) ? value.toLowerCase() : 'other');
function originOf(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}

// R3.5: the one POST that a Cloudflare challenge sends to the own origin.
const CHALLENGE = /^\/cdn-cgi\/challenge-platform(?:\/[A-Za-z0-9._~:+=-]+)+$/;

// Reads the DevTools log of one audit. Returns the blocked requests as
// `{ resourceType, origin, count }` groups and the first violation, or null.
// A violation fails the target: a write method, a WebSocket, a failed request to an
// allowed origin. A blocked request never does.
export function requestEvidence(events, { origin, allowOrigins = [], challenge = null }) {
  if (!Array.isArray(events)) throw new Error('Performance request evidence is unavailable.');
  const own = new URL(origin).origin;
  const ownHost = host(own);
  const allowedHosts = new Set(allowOrigins.map(host));
  const requests = new Map();
  const groups = new Map();
  let violation = null;
  const violate = text => { violation ??= text; };
  for (const event of events) {
    const params = event?.params ?? {};
    if (event?.method === 'Network.webSocketCreated') { violate(`WebSocket to ${originOf(params.url) ?? 'an unknown origin'}`); continue; }
    if (event?.method === 'Network.requestWillBeSent') {
      const request = params.request ?? {};
      const target = originOf(request.url);
      const type = typeOf(params.type);
      requests.set(params.requestId, { origin: target, type });
      if (target === null) continue;
      const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
      if (method === 'GET' || method === 'HEAD') continue;
      let path = null;
      try { path = new URL(request.url).pathname; } catch { /* The origin check above passed. */ }
      if (challenge === 'cloudflare' && method === 'POST' && target === own && type !== 'document' && CHALLENGE.test(path ?? '')) continue;
      violate(`${/^[A-Z]{1,20}$/.test(method) ? method : 'A write method'} ${type} request to ${target}`);
      continue;
    }
    if (event?.method !== 'Network.loadingFailed') continue;
    const request = requests.get(params.requestId);
    if (!request || request.origin === null) continue;
    const name = new URL(request.origin).hostname.toLowerCase();
    const blockedByPath = params.blockedReason === 'inspector';
    const blockedByHost = params.errorText === 'net::ERR_NAME_NOT_RESOLVED' && name !== ownHost && !allowedHosts.has(name);
    if (blockedByPath || blockedByHost) {
      const key = `${request.type} ${request.origin}`;
      groups.set(key, { resourceType: request.type, origin: request.origin, count: (groups.get(key)?.count ?? 0) + 1 });
    } else if (allowedHosts.has(name) && name !== ownHost && params.canceled !== true) {
      violate(`An allowed origin failed: ${request.type} request to ${request.origin}`);
    }
  }
  const blocked = [...groups.values()].sort((a, b) => b.count - a.count || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : a.resourceType < b.resourceType ? -1 : 1));
  return { blocked: blocked.slice(0, MAX_GROUPS), omitted: blocked.slice(MAX_GROUPS).reduce((sum, group) => sum + group.count, 0), violation };
}

// Adds the groups of one audit to the groups of the target.
export function mergeBlocked(total, next) {
  const groups = new Map(total.map(group => [`${group.resourceType} ${group.origin}`, { ...group }]));
  for (const group of next) {
    const key = `${group.resourceType} ${group.origin}`;
    groups.set(key, { ...group, count: (groups.get(key)?.count ?? 0) + group.count });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : a.resourceType < b.resourceType ? -1 : 1));
}

// R6.17: the page navigation must end on the own origin. Lighthouse reports the final URL.
export function finalOriginProblem(lhr, origin) {
  const final = originOf(lhr?.finalDisplayedUrl ?? lhr?.finalUrl);
  if (final === null) return 'The final page URL is unavailable.';
  return final === new URL(origin).origin ? null : `The page navigation ended on ${final}.`;
}
