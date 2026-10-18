// Pure. Turns recorded ESLint and Stylelint JSON into stored lint items. No file system, no process (R4.4).
// Formats checked against the official documentation on 2026-10-18 and against real runs (ESLint 9.39.5, Stylelint 16.26.1):
//   ESLint json formatter: https://eslint.org/docs/latest/use/formatters/
//   ESLint exit codes: https://eslint.org/docs/latest/use/command-line-interface
//   Stylelint result object: https://stylelint.io/user-guide/node-api/
//   Stylelint exit codes: https://stylelint.io/user-guide/cli/
import { posix } from 'node:path';

export const TOOLS = Object.freeze(['eslint', 'stylelint']);
// Chosen safety bounds, not measured numbers.
export const MAX_ITEMS = 999; // 999 items plus one marker stay inside the 1000 findings cap of the pack API
export const MAX_FINDINGS = MAX_ITEMS + 1;
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_MESSAGE = 1000;
const MAX_FILE = 500;
const MAX_RULE = 200;
export const TARGET_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPosInt = value => Number.isInteger(value) && value > 0;
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const isAbsolute = text => text.startsWith('/') || /^[A-Za-z]:\//.test(text);
const baseName = text => cut(text.split('/').filter(part => part !== '' && part !== '.' && part !== '..').pop() || 'unknown', MAX_FILE);

// Returns a path relative to one of the roots. The result never holds a host directory or a `..` segment.
// A path outside every root keeps only its base name. `roots` is a string or a list (a root and its realpath).
export function relativeFile(file, roots) {
  let text = String(file);
  if (text.startsWith('file://')) {
    try { text = decodeURIComponent(text.slice(7)); } catch { return 'unknown'; }
  }
  text = text.replaceAll('\\', '/');
  if (text.includes('\0')) return 'unknown';
  const clean = posix.normalize(text); // resolves `.` and `..` before any prefix test
  if (!isAbsolute(clean)) {
    if (clean === '.' || clean === '..' || clean.startsWith('../')) return baseName(clean);
    return cut(clean, MAX_FILE);
  }
  for (const root of [roots].flat().filter(item => typeof item === 'string' && item !== '')) {
    const base = posix.normalize(root.replaceAll('\\', '/')).replace(/\/+$/, '');
    if (base !== '' && clean.startsWith(`${base}/`)) return cut(clean.slice(base.length + 1), MAX_FILE);
  }
  return baseName(clean);
}

// Validates a stored or produced location. Throws on a bad shape. Returns a new plain object (R9.11).
export function checkLocation(value) {
  if (!isObject(value)) throw new Error('A location must be an object.');
  const { file, line, column, ...rest } = value; // one read of each field
  if (Object.keys(rest).length > 0) throw new Error('A location has an unknown key.');
  if (typeof file !== 'string' || file === '' || file.length > MAX_FILE) throw new Error('A location needs a file.');
  if (line !== undefined && !isPosInt(line)) throw new Error('A location has a bad line.');
  if (column !== undefined && (line === undefined || !isPosInt(column))) throw new Error('A location has a bad column.');
  return { file, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) };
}

function item(rule, severity, message, file, line, column) {
  return {
    severity,
    rule: rule === null ? null : cut(rule, MAX_RULE),
    message: cut(message.trim() || 'The tool reported a problem.', MAX_MESSAGE),
    location: { file, ...(isPosInt(line) ? { line } : {}), ...(isPosInt(line) && isPosInt(column) ? { column } : {}) },
  };
}

const result = found => ({ items: found.slice(0, MAX_ITEMS), total: found.length });

// ESLint `-f json`: an array with one object for each file (`filePath`, `messages`).
// A message has `ruleId` (null for a parse error), `severity` (1 warning, 2 error), `message`, `line`, `column`.
// Returns { items, total }. `total` greater than `items.length` means the list is cut.
export function normalizeEslint(output, { root } = {}) {
  if (!Array.isArray(output)) throw new Error('ESLint output must be a list of file results.');
  const found = [];
  for (const entry of output) {
    if (!isObject(entry) || typeof entry.filePath !== 'string' || !Array.isArray(entry.messages)) throw new Error('ESLint output has a malformed file result.');
    const file = relativeFile(entry.filePath, root);
    for (const message of entry.messages) {
      if (!isObject(message) || typeof message.message !== 'string') throw new Error('ESLint output has a malformed message.');
      if (message.severity !== 1 && message.severity !== 2) throw new Error('ESLint output has an unknown severity.');
      if (message.ruleId !== null && message.ruleId !== undefined && typeof message.ruleId !== 'string') throw new Error('ESLint output has a malformed rule id.');
      found.push(item(message.ruleId ?? null, message.severity === 2 ? 'error' : 'warning', message.message, file, message.line, message.column));
    }
  }
  return result(found);
}

// Stylelint `-f json`: an array with one object for each source (`source`, `warnings`, `invalidOptionWarnings`).
// A warning has `rule`, `severity` ("error" or "warning"), `text`, `line`, `column`.
export function normalizeStylelint(output, { root } = {}) {
  if (!Array.isArray(output)) throw new Error('Stylelint output must be a list of file results.');
  const found = [];
  for (const entry of output) {
    if (!isObject(entry) || typeof entry.source !== 'string' || !Array.isArray(entry.warnings)) throw new Error('Stylelint output has a malformed file result.');
    // An invalid option means the configuration is wrong. The run proves nothing.
    if (Array.isArray(entry.invalidOptionWarnings) && entry.invalidOptionWarnings.length > 0) throw new Error('Stylelint reported an invalid option in the configuration.');
    const file = relativeFile(entry.source, root);
    for (const warning of entry.warnings) {
      if (!isObject(warning) || typeof warning.text !== 'string') throw new Error('Stylelint output has a malformed warning.');
      if (warning.severity !== 'error' && warning.severity !== 'warning') throw new Error('Stylelint output has an unknown severity.');
      if (warning.rule !== undefined && typeof warning.rule !== 'string') throw new Error('Stylelint output has a malformed rule.');
      const rule = warning.rule ?? null;
      // Stylelint appends " (rule)" to the text. The rule has its own field.
      const text = rule && warning.text.endsWith(` (${rule})`) ? warning.text.slice(0, -(rule.length + 3)) : warning.text;
      found.push(item(rule, warning.severity, text, file, warning.line, warning.column));
    }
  }
  return result(found);
}

const countErrors = (tool, output) => (tool === 'eslint'
  ? output.reduce((sum, entry) => sum + (Array.isArray(entry?.messages) ? entry.messages.filter(message => message?.severity === 2).length : 0), 0)
  : output.reduce((sum, entry) => sum + (Array.isArray(entry?.warnings) ? entry.warnings.filter(warning => warning?.severity === 'error').length : 0), 0));
const hasInvalidOption = output => output.some(entry => Array.isArray(entry?.invalidOptionWarnings) && entry.invalidOptionWarnings.length > 0);

// Judges one process run. ESLint exit 1 and Stylelint exit 2 with findings are a normal run, not a failure.
// A crash, a signal, a timeout, text that is not JSON, or an exit code that contradicts the JSON is `failed`.
// Observed: ESLint exits 2 for a configuration problem or no matching file. Stylelint exits 1 for a fatal error
// such as no matching file, and exits 2 with empty `warnings` and an `invalidOptionWarnings` entry for a bad option.
// Returns { status: 'ok' | 'failed', output?, diagnostic? }.
export function judgeRun({ tool, exitCode, signal = null, text }) {
  if (!TOOLS.includes(tool)) throw new Error('Unknown lint tool.');
  const problem = tool === 'eslint' ? 1 : 2;
  if (signal) return { status: 'failed', diagnostic: `${tool} stopped by signal ${String(signal).slice(0, 20)}.` };
  if (exitCode !== 0 && exitCode !== problem) {
    const why = tool === 'eslint' && exitCode === 2 ? 'a configuration problem, an internal error or no matching file' : tool === 'stylelint' && exitCode === 1 ? 'a fatal error, for example no matching file' : 'a crash or a configuration problem';
    return { status: 'failed', diagnostic: `${tool} exited with code ${exitCode}. That means ${why}, not a lint result.` };
  }
  if (typeof text !== 'string' || text.length > MAX_OUTPUT_BYTES) return { status: 'failed', diagnostic: `${tool} wrote no usable report, or a report over ${MAX_OUTPUT_BYTES} bytes.` };
  let output;
  try { output = JSON.parse(text); } catch { return { status: 'failed', diagnostic: `${tool} wrote output that is not JSON.` }; }
  if (!Array.isArray(output)) return { status: 'failed', diagnostic: `${tool} wrote JSON that is not a list of file results.` };
  if (tool === 'stylelint' && hasInvalidOption(output)) return { status: 'failed', diagnostic: 'stylelint reported an invalid option in the configuration. This is a configuration problem, not a lint result.' };
  const errors = countErrors(tool, output);
  if (exitCode === 0 && errors > 0) return { status: 'failed', diagnostic: `${tool} exited with code 0 but the output holds errors.` };
  if (exitCode === problem && errors === 0) return { status: 'failed', diagnostic: `${tool} exited with code ${problem} but the output holds no error.` };
  return { status: 'ok', output };
}
