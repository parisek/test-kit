// Pure. Detects the major version of a library from a version string or number and its source.
// It has no DOM and no file system access (R4.4). It never guesses: bad input gives `unknown` (R13.42, R8.7).
export const VERSION_SOURCES = Object.freeze(['lockfile', 'bundle-banner', 'config']);
const EXACT = /^v?(0|[1-9]\d{0,3})(?:\.(?:0|[1-9]\d{0,5})){0,2}$/; // 12, 12.2, 12.2.0, v12.2.0. No range, no prerelease.
const echo = value => (typeof value === 'string' ? value.slice(0, 64) : typeof value === 'number' ? String(value) : null);

function ownValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

const unknown = (version, source, diagnostic) => Object.freeze({
  state: 'unknown', major: null, version: echo(version), source: VERSION_SOURCES.includes(source) ? source : null, diagnostic,
});

// Input: { version, source }. `version` is a string like "12.2.0" or an integer major. `source` is one of VERSION_SOURCES.
// Output: a frozen { state: 'detected' | 'unknown', major, version, source, diagnostic? }.
export function detectMajor(input) {
  if (!input || typeof input !== 'object') return unknown(null, null, 'No version was detected.');
  // Own enumerable data properties only. An inherited field, a getter or a symbol-keyed trick gives unknown. One read of each field.
  const version = ownValue(input, 'version');
  const source = ownValue(input, 'source');
  if (!VERSION_SOURCES.includes(source)) return unknown(version, null, `The version source must be one of ${VERSION_SOURCES.join(', ')}.`);
  if (typeof version === 'number') {
    if (!Number.isSafeInteger(version) || version < 0 || version > 9999) return unknown(version, source, 'A numeric version must be a whole major number.');
    return Object.freeze({ state: 'detected', major: version, version: String(version), source });
  }
  if (typeof version !== 'string') return unknown(version, source, 'No version was detected.');
  const match = EXACT.exec(version);
  if (!match) return unknown(version, source, 'The version is not an exact release number. A range or a prerelease cannot select a contract set.');
  return Object.freeze({ state: 'detected', major: Number(match[1]), version, source });
}

// Reads the banner comment that a Swiper bundle starts with, for example "Swiper 14.3.0". Input is the first text of the file.
// Returns a { version, source } for detectMajor, or null.
export function bundleBannerVersion(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || !/^[A-Za-z][\w.-]{0,40}$/.test(name)) return null;
  // A linear parse of the first lines. No backtracking, so a hostile input cannot slow it down.
  const lines = text.slice(0, 2000).split('\n', 4).map(line => line.trim());
  if (lines[0] !== '/**' && lines[0] !== '/*') return null;
  const line = (lines[1] ?? '').replace(/^\*+/, '').trim();
  const prefix = `${name.toLowerCase()} `;
  if (!line.toLowerCase().startsWith(prefix)) return null;
  const version = line.slice(prefix.length);
  return /^\d{1,4}\.\d{1,6}\.\d{1,6}(?:-[\w.]{1,40})?$/.test(version) ? { version, source: 'bundle-banner' } : null;
}

// Reads one package from parsed package-lock.json data (lockfileVersion 2 or 3). Returns { version, source } or null.
// It looks at every copy of the package (top level and nested). When copies have different majors, the answer is null,
// so the version stays unknown and nothing passes by chance.
export function lockfileVersion(lock, name) {
  if (!lock || typeof lock !== 'object' || typeof name !== 'string' || name === '') return null;
  const packages = lock.packages; // one read
  if (!packages || typeof packages !== 'object') return null;
  const top = `node_modules/${name}`;
  const tail = `/node_modules/${name}`;
  let topVersion = null;
  const majors = new Set();
  for (const key of Object.keys(packages)) {
    if (key !== top && !key.endsWith(tail)) continue;
    const entry = packages[key]; // one read
    const version = entry && typeof entry === 'object' ? entry.version : undefined; // one read
    if (typeof version !== 'string') return null;
    majors.add(version.split('.')[0]);
    if (key === top) topVersion = version;
  }
  return topVersion !== null && majors.size === 1 ? { version: topVersion, source: 'lockfile' } : null;
}
