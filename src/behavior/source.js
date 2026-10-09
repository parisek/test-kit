import { readdir, realpath, lstat, readFile } from 'node:fs/promises';
import { resolve, relative, join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { collectContracts, validateContracts } from './contracts.js';
import { relativePath } from '../report/safe.js';

const loadedFingerprints = new Map();

// Imports are trusted project code. This loader is never called for report data.
export async function loadBehaviorSource({ projectRoot, directory, lockfile = 'package-lock.json' }) {
  if (!relativePath(directory) || !relativePath(lockfile)) throw new Error('Behavior source paths must be relative to the project.');
  const root = await realpath(projectRoot);
  const inside = async path => {
    const actual = await realpath(path), offset = relative(root, actual);
    if (!offset || offset.startsWith('..') || offset.startsWith('/')) throw new Error('Behavior source escapes the project.');
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Behavior source must not use symbolic links.');
    return actual;
  };
  const sourceRoot = await inside(resolve(root, directory));
  const files = [], hashes = [], maxBytes = 8 * 1024 * 1024;
  let total = 0, directories = 0;
  const add = async file => {
    const actual = await inside(file);
    const info = await lstat(actual);
    if (!info.isFile() || info.size > 2 * 1024 * 1024 || total + info.size > maxBytes) throw new Error('Behavior source exceeds its byte limit.');
    const body = await readFile(actual);
    total += body.length;
    if (body.length > 2 * 1024 * 1024 || total > maxBytes || files.length >= 500) throw new Error('Behavior source exceeds its file or byte limit.');
    const path = relative(root, actual).split('\\').join('/');
    files.push(actual); hashes.push({ path, hash: createHash('sha256').update(body).digest('hex') });
  };
  const walk = async path => {
    if (++directories > 500) throw new Error('Behavior source exceeds its directory limit.');
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Behavior source must not use symbolic links.');
      if (entry.isDirectory()) { if (!['node_modules', '.git', 'vendor'].includes(entry.name)) await walk(join(path, entry.name)); }
      else if (entry.isFile() && /\.(?:js|mjs|cjs|json)$/.test(entry.name)) await add(join(path, entry.name));
    }
  };
  await walk(sourceRoot);
  // Relative helper imports must remain in the hashed source tree.
  for (const file of files.filter(path => /\.(?:js|mjs|cjs)$/.test(path))) {
    const code = await readFile(file, 'utf8');
    const imports = code.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g);
    for (const match of imports) {
      const helper = await inside(resolve(dirname(file), match[1]));
      if (!files.includes(helper)) throw new Error('A behavior helper is outside the hashed source tree. Use a common source directory.');
    }
  }
  await add(resolve(root, lockfile));
  const fingerprint = createHash('sha256').update(JSON.stringify(hashes.sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
  if (loadedFingerprints.has(sourceRoot) && loadedFingerprints.get(sourceRoot) !== fingerprint) throw new Error('Behavior source changes after import. Start a new process to avoid cached helper code.');
  const contracts = [];
  for (const file of files.filter(path => basename(path).endsWith('.contract.js')).sort()) contracts.push(...collectContracts(await import(pathToFileURL(file).href)));
  validateContracts(contracts);
  loadedFingerprints.set(sourceRoot, fingerprint);
  if (!contracts.length) throw new Error('Behavior source contains no contracts.');
  const lock = JSON.parse(await readFile(resolve(root, lockfile), 'utf8'));
  const libraryVersions = {};
  for (const contract of contracts) {
    if (contract.library?.package) { const name = contract.library.package; const version = lock.packages?.[`node_modules/${name}`]?.version ?? lock.dependencies?.[name]?.version; if (typeof version === 'string') libraryVersions[name] = version; }
  }
  return { contracts, libraryVersions, contractFingerprints: Object.fromEntries(contracts.map(contract => [contract.name, fingerprint])), fingerprint };
}
