// Impure. Runs the project's own ESLint and Stylelint and returns the `lint` artifact value (R9.9).
// It never bundles a linter and never runs unless a project calls it with explicit tools and paths (G3, R5.1).
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { judgeRun, normalizeEslint, normalizeStylelint, TOOLS, MAX_OUTPUT_BYTES, copyFileTargets } from './normalize.js';

// Chosen bounds, not measured numbers.
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_KILL_GRACE_MS = 2000;
const MAX_PATHS = 100;
// No brace, comma, bracket or parenthesis: a shell-style brace list could expand to an absolute or parent path.
const PLAIN_PATH = /^[A-Za-z0-9_@./*-]+$/;
const NORMALIZERS = { eslint: normalizeEslint, stylelint: normalizeStylelint };

// The child gets this named list and nothing else. No NODE_* variable passes: NODE_OPTIONS can preload code,
// and NODE_PATH, NODE_AUTH_TOKEN and NODE_TLS_* change trust. A project adds any of them with the `env` option.
const ENV_NAMES = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL', 'NO_COLOR', 'FORCE_COLOR'];
export function childEnv(extra = {}, parent = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(parent)) if (typeof value === 'string' && ENV_NAMES.includes(name)) env[name] = value;
  for (const [name, value] of Object.entries(extra ?? {})) {
    if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('The env option needs string values and plain names.');
    env[name] = value;
  }
  return env;
}

// A value that reaches a process must be a plain relative path or glob (AGENTS.md rules).
export function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) throw new Error('A lint tool needs 1 to 100 paths.');
  return paths.map(item => {
    if (typeof item !== 'string' || item === '' || item.length > 200 || !PLAIN_PATH.test(item) || item.startsWith('-') || item.startsWith('/') || item.split('/').includes('..')) throw new Error(`Invalid lint path: ${String(item).slice(0, 50)}`);
    return item;
  });
}

// Finds <root>/node_modules/<tool>. With `hoisted: true` it also looks in each parent directory, as Node does,
// for a monorepo. By default it stops at the project root, so a package above the project is never run.
// Returns { version, bin } or null.
export function findTool(root, tool, { hoisted = false } = {}) {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'node_modules', tool, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[tool];
        if (typeof bin !== 'string' || typeof pkg.version !== 'string') return null;
        const full = path.resolve(path.dirname(manifest), bin);
        if (!full.startsWith(path.dirname(manifest) + path.sep)) return null;
        return { version: pkg.version.slice(0, 50), bin: full };
      } catch { return null; }
    }
    if (!hoisted || path.dirname(dir) === dir) return null;
  }
}

const killGroup = (child, signal) => {
  if (!Number.isInteger(child.pid)) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    else process.kill(-child.pid, signal); // the child leads its own process group, so this reaches its children too
  } catch { /* ESRCH: nothing left in the group */ }
};

// After the leader was reaped, kill what is left in its group. The probe `kill(-pid, 0)` throws when the group is empty
// (ESRCH) or not ours (EPERM): then nothing is killed. If it succeeds, the group still has live members. A process group id
// cannot be reused while any member lives, so those members are descendants of the tool. The check-then-kill window is
// a few microseconds; a group of the same id can appear in it only if the last member exits and the kernel hands the
// pid out again in that time. That is negligible. `kill` is injectable for tests. Returns 'skipped' or 'killed'.
export function sweepGroup(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 1) return 'skipped';
  try { kill(-pid, 0); } catch { return 'skipped'; }
  try { kill(-pid, 'SIGKILL'); } catch { return 'skipped'; }
  return 'killed';
}

// Runs the tool and always settles. At the timeout it sends SIGTERM to the group, then SIGKILL after the grace time,
// then it resolves even if the process never reports `close`. On Windows it uses `taskkill /T /F`; that path is not tested.
// A tool that starts a process in a new session or group (setsid) escapes the group kill.
function run(file, args, { cwd, timeout, grace, env }) {
  return new Promise(resolve => {
    let settled = false;
    const timers = [];
    const done = value => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      resolve(value);
    };
    let child;
    try {
      child = spawn(process.execPath, [file, ...args], { cwd, env, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
    } catch { done({ exitCode: null, signal: null, spawnError: true }); return; }
    let timedOut = false;
    child.once('error', () => done({ exitCode: null, signal: null, spawnError: true }));
    child.once('close', (exitCode, signal) => {
      // The leader has ended. Kill what is left in its group, on every path, before the result is returned.
      // ESRCH (nothing left) is ignored. A tool that left a child after exit 0 does not keep it running.
      // On Windows nothing runs here: the leader pid is dead and may be reused, and taskkill cannot find its tree.
      if (process.platform !== 'win32') sweepGroup(child.pid);
      done({ exitCode, signal: timedOut ? 'TIMEOUT' : signal, spawnError: false });
    });
    timers.push(setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      timers.push(setTimeout(() => {
        killGroup(child, 'SIGKILL');
        timers.push(setTimeout(() => done({ exitCode: null, signal: 'TIMEOUT', spawnError: false }), 500)); // hard stop
      }, grace));
    }, timeout));
  });
}

async function readBounded(file) {
  const info = await stat(file);
  if (info.size > MAX_OUTPUT_BYTES) return null;
  return readFile(file, 'utf8');
}

async function runTool(root, roots, tool, config, options) {
  const paths = validatePaths(config?.paths); // bad paths are reported before the tool lookup
  const found = findTool(root, tool, options);
  if (!found) return { status: 'missing', diagnostic: `${tool} is not installed in the project. Add it as a project dependency.` };
  const dir = await mkdtemp(path.join(tmpdir(), 'test-kit-lint-'));
  const file = path.join(dir, `${tool}.json`);
  try {
    const result = await run(found.bin, ['-f', 'json', '-o', file, ...paths], { cwd: root, timeout: options.timeoutMs, grace: options.killGraceMs, env: options.env });
    if (result.spawnError) return { status: 'failed', version: found.version, diagnostic: `${tool} could not start.` };
    let text = '';
    try { text = await readBounded(file); } catch { text = ''; } // no output file: judgeRun reports it
    const judged = judgeRun({ tool, exitCode: result.exitCode, signal: result.signal, text });
    if (judged.status !== 'ok') return { status: 'failed', version: found.version, diagnostic: judged.diagnostic };
    // Only normalized, relative data is stored. The raw tool output, with its absolute paths, is dropped.
    const { items, total } = NORMALIZERS[tool](judged.output, { root: roots });
    return { status: 'ok', version: found.version, items, total };
  } catch (error) {
    return { status: 'failed', diagnostic: `${tool} output could not be used: ${String(error?.message ?? error).slice(0, 200)}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// tools: { eslint?: { paths: [...] }, stylelint?: { paths: [...] } }. A tool left out does not run.
// fileTargets: optional { "<relative file>": "<component id>" }. A file not listed maps to `@project` (R9.11).
// env: optional extra environment variables for the child. hoisted: look for the tool above the root.
export async function runLint({ root, tools, fileTargets, env, hoisted = false, timeoutMs = DEFAULT_TIMEOUT_MS, killGraceMs = DEFAULT_KILL_GRACE_MS }) {
  if (typeof root !== 'string' || root === '') throw new Error('runLint needs a project root.');
  if (!tools || typeof tools !== 'object') throw new Error('runLint needs tools.');
  const names = Object.keys(tools);
  if (names.length === 0) throw new Error('runLint needs at least one tool.');
  for (const name of names) if (!TOOLS.includes(name)) throw new Error(`Unknown lint tool: ${name}`);
  for (const name of names) validatePaths(tools[name]?.paths); // every tool is checked before any tool runs
  const map = copyFileTargets(fileTargets); // throws on a bad container, key or id
  const resolved = path.resolve(root);
  const real = await realpath(resolved).catch(() => resolved);
  // A filesystem root ('/' or a drive root) is never a project root: the scan and the path scrub would cover the machine.
  if (path.parse(resolved).root === resolved || path.parse(real).root === real) {
    const failed = { status: 'failed', diagnostic: 'The project root is a filesystem root. Run lint from a project directory.' };
    return { tools: Object.fromEntries(names.map(name => [name, failed])) };
  }
  const options = { env: childEnv(env), hoisted, timeoutMs, killGraceMs };
  const out = {};
  for (const name of names) out[name] = await runTool(resolved, [resolved, real], name, tools[name], options);
  return { ...(Object.keys(map).length > 0 ? { fileTargets: map } : {}), tools: out };
}
