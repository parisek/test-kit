// Pure. Turns recorded ESLint and Stylelint JSON into pack findings. No file system, no process (R4.4).
// Formats checked against the official documentation on 2026-10-18:
//   ESLint json formatter: https://eslint.org/docs/latest/use/formatters/
//   ESLint exit codes: https://eslint.org/docs/latest/use/command-line-interface
//   Stylelint result object: https://stylelint.io/user-guide/node-api/
//   Stylelint exit codes: https://stylelint.io/user-guide/cli/
export const TOOLS = Object.freeze(['eslint', 'stylelint']);
// Chosen safety bounds, not measured numbers.
export const MAX_FINDINGS = 1000;
const MAX_MESSAGE = 1000;
const MAX_FILE = 500;
const MAX_RULE = 200;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPosInt = value => Number.isInteger(value) && value > 0;
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

// A path inside the root becomes relative. A path outside the root keeps only its base name,
// so a finding never carries a host path (R12.4).
export function relativeFile(file, root) {
  const clean = String(file).replaceAll('\\', '/');
  const base = String(root ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (base && clean.startsWith(`${base}/`)) return cut(clean.slice(base.length + 1), MAX_FILE);
  if (!clean.startsWith('/') && !/^[A-Za-z]:\//.test(clean)) return cut(clean.replace(/^(\.\/)+/, ''), MAX_FILE);
  return cut(clean.split('/').pop() || 'unknown', MAX_FILE);
}

function location(file, line, column) {
  return { file, ...(isPosInt(line) ? { line } : {}), ...(isPosInt(line) && isPosInt(column) ? { column } : {}) };
}

function finding(tool, rule, severity, message, loc) {
  return {
    severity,
    message: cut(message.trim() || `${tool} reported a problem.`, MAX_MESSAGE),
    evidence: { tool, rule: rule === null ? null : cut(rule, MAX_RULE), location: loc },
  };
}

// The marker that makes a check `missing` when the list is cut (R8.7). A cut list never reads as complete.
const truncated = (tool, total) => ({
  severity: 'info',
  message: `The ${tool} report has ${total} problems. Only the first ${MAX_FINDINGS - 1} are listed.`,
  evidence: { tool, state: 'incomplete', total },
});

function finish(tool, found) {
  if (found.length <= MAX_FINDINGS) return found;
  return [...found.slice(0, MAX_FINDINGS - 1), truncated(tool, found.length)];
}

// ESLint `-f json`: an array with one object for each file (`filePath`, `messages`).
// A message has `ruleId` (null for a parse error), `severity` (1 warning, 2 error), `message`, `line`, `column`.
export function normalizeEslint(output, { root } = {}) {
  if (!Array.isArray(output)) throw new Error('ESLint output must be a list of file results.');
  const found = [];
  for (const entry of output) {
    if (!isObject(entry) || typeof entry.filePath !== 'string' || !Array.isArray(entry.messages)) throw new Error('ESLint output has a malformed file result.');
    const file = relativeFile(entry.filePath, root);
    for (const item of entry.messages) {
      if (!isObject(item) || typeof item.message !== 'string') throw new Error('ESLint output has a malformed message.');
      if (item.severity !== 1 && item.severity !== 2) throw new Error('ESLint output has an unknown severity.');
      if (item.ruleId !== null && item.ruleId !== undefined && typeof item.ruleId !== 'string') throw new Error('ESLint output has a malformed rule id.');
      found.push(finding('eslint', item.ruleId ?? null, item.severity === 2 ? 'error' : 'warning', item.message, location(file, item.line, item.column)));
    }
  }
  return finish('eslint', found);
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
    for (const item of entry.warnings) {
      if (!isObject(item) || typeof item.text !== 'string') throw new Error('Stylelint output has a malformed warning.');
      if (item.severity !== 'error' && item.severity !== 'warning') throw new Error('Stylelint output has an unknown severity.');
      if (item.rule !== undefined && typeof item.rule !== 'string') throw new Error('Stylelint output has a malformed rule.');
      const rule = item.rule ?? null;
      // Stylelint appends " (rule)" to the text. The rule has its own field.
      const text = rule && item.text.endsWith(` (${rule})`) ? item.text.slice(0, -(rule.length + 3)) : item.text;
      found.push(finding('stylelint', rule, item.severity, text, location(file, item.line, item.column)));
    }
  }
  return finish('stylelint', found);
}

const countErrors = (tool, output) => (tool === 'eslint'
  ? output.reduce((sum, entry) => sum + (Array.isArray(entry?.messages) ? entry.messages.filter(item => item?.severity === 2).length : 0), 0)
  : output.reduce((sum, entry) => sum + (Array.isArray(entry?.warnings) ? entry.warnings.filter(item => item?.severity === 'error').length : 0), 0));

// Judges one process run. Exit code 1 (ESLint) or 2 (Stylelint) with findings is a normal run, not a failure.
// A crash, a signal, a timeout, text that is not JSON, or an exit code that contradicts the JSON is `failed`.
// Returns { status: 'ok' | 'failed', output?, diagnostic? }.
export function judgeRun({ tool, exitCode, signal = null, text }) {
  if (!TOOLS.includes(tool)) throw new Error('Unknown lint tool.');
  const problem = tool === 'eslint' ? 1 : 2;
  if (signal) return { status: 'failed', diagnostic: `${tool} stopped by signal ${String(signal).slice(0, 20)}.` };
  if (exitCode !== 0 && exitCode !== problem) return { status: 'failed', diagnostic: `${tool} exited with code ${exitCode}. That is a crash or a configuration problem, not a lint result.` };
  let output;
  try { output = JSON.parse(text); } catch { return { status: 'failed', diagnostic: `${tool} wrote output that is not JSON.` }; }
  if (!Array.isArray(output)) return { status: 'failed', diagnostic: `${tool} wrote JSON that is not a list of file results.` };
  const errors = countErrors(tool, output);
  if (exitCode === 0 && errors > 0) return { status: 'failed', diagnostic: `${tool} exited with code 0 but the output holds errors.` };
  if (exitCode === problem && errors === 0) return { status: 'failed', diagnostic: `${tool} exited with code ${problem} but the output holds no error.` };
  return { status: 'ok', output };
}
