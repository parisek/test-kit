// Impure. Runs the project's own ESLint and Stylelint and returns the `lint` artifact value (R9.9).
// It never bundles a linter and never runs unless a project calls it with explicit tools and paths (G3, R5.1).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { judgeRun, TOOLS } from './normalize.js';

const DEFAULT_TIMEOUT_MS = 120000; // chosen bound, not measured
const MAX_PATHS = 100;
const PLAIN_PATH = /^[A-Za-z0-9_@./*{},-][A-Za-z0-9_@./*{},-]*$/;

// A value that reaches a process must be a plain relative path or glob (AGENTS.md rules).
export function validatePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) throw new Error('A lint tool needs 1 to 100 paths.');
  return paths.map(item => {
    if (typeof item !== 'string' || item === '' || item.length > 200 || !PLAIN_PATH.test(item) || item.startsWith('-') || item.startsWith('/') || item.split('/').includes('..')) throw new Error(`Invalid lint path: ${String(item).slice(0, 50)}`);
    return item;
  });
}

// Finds <root>/node_modules/<tool>, then each parent, as Node does. Returns { dir, version, bin } or null.
export function findTool(root, tool) {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'node_modules', tool, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[tool];
        if (typeof bin !== 'string' || typeof pkg.version !== 'string') return null;
        const full = path.resolve(path.dirname(manifest), bin);
        if (!full.startsWith(path.dirname(manifest) + path.sep)) return null;
        return { version: pkg.version, bin: full };
      } catch { return null; }
    }
    if (path.dirname(dir) === dir) return null;
  }
}

const run = (file, args, cwd, timeout) => new Promise(resolve => {
  execFile(process.execPath, [file, ...args], { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, error => {
    resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0, signal: error?.signal ?? null, spawnError: error && typeof error.code !== 'number' && !error.signal ? error : null });
  });
});

async function runTool(root, tool, config, timeout) {
  const found = findTool(root, tool);
  if (!found) return { status: 'missing', diagnostic: `${tool} is not installed in the project. Add it as a project dependency.` };
  const paths = validatePaths(config?.paths);
  const dir = await mkdtemp(path.join(tmpdir(), 'test-kit-lint-'));
  const file = path.join(dir, `${tool}.json`);
  try {
    const args = ['-f', 'json', '-o', file, ...paths]; // both CLIs accept -f and -o
    const result = await run(found.bin, args, root, timeout);
    if (result.spawnError) return { status: 'failed', version: found.version, diagnostic: `${tool} could not start.` };
    let text = '';
    try { text = await readFile(file, 'utf8'); } catch { /* no output file: judgeRun reports it */ }
    const judged = judgeRun({ tool, exitCode: result.exitCode, signal: result.signal, text });
    return judged.status === 'ok' ? { status: 'ok', version: found.version, output: judged.output } : { status: 'failed', version: found.version, diagnostic: judged.diagnostic };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// tools: { eslint?: { paths: [...] }, stylelint?: { paths: [...] } }. A tool left out does not run.
export async function runLint({ root, tools, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof root !== 'string' || root === '') throw new Error('runLint needs a project root.');
  if (!tools || typeof tools !== 'object') throw new Error('runLint needs tools.');
  const out = {};
  for (const tool of Object.keys(tools)) {
    if (!TOOLS.includes(tool)) throw new Error(`Unknown lint tool: ${tool}`);
    out[tool] = await runTool(root, tool, tools[tool], timeoutMs);
  }
  if (Object.keys(out).length === 0) throw new Error('runLint needs at least one tool.');
  return { root: path.resolve(root), tools: out };
}
