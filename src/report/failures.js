// R5.16, #416: one stderr line for each failed cell of a capture, so a person sees which cells failed and why
// without reading run.json. Stdout stays one JSON line. Pure: no DOM, no file system.
// Run data is untrusted: an id, a code or a path that does not have its plain shape is left out of the line.
export const FAILURE_LINE_LIMIT = 20;

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
// A path that is safe to print: a slash, then printable ASCII without spaces, quotes or a backslash, at most 200 characters.
const PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#[\]-]{0,199}$/;

const plain = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;

// The reason of one cell, or null when the cell has no failure. A failed cell names its error code.
// A captured cell with a failed artifact names the artifact and its code, because it also makes the run incomplete.
function failureOf(capture) {
  if (!capture || typeof capture !== 'object') return null;
  if (capture.state === 'failed') return { code: plain(capture.error?.code, CODE) ?? 'UNKNOWN', artifact: null };
  if (capture.state !== 'captured' || !capture.artifacts || typeof capture.artifacts !== 'object') return null;
  for (const [kind, index] of Object.entries(capture.artifacts)) {
    if (index?.state === 'failed') return { code: plain(index.error?.code, CODE) ?? 'UNKNOWN', artifact: plain(kind, ID) ?? 'artifact' };
  }
  return null;
}

// The lines, at most `limit`, then one line "and N more failed cells". No failure gives an empty list.
export function failedCellLines(run, limit = FAILURE_LINE_LIMIT) {
  const failures = [];
  for (const capture of Array.isArray(run?.captures) ? run.captures : []) {
    const failure = failureOf(capture);
    if (failure) failures.push({ capture, ...failure });
  }
  const lines = failures.slice(0, limit).map(({ capture, code, artifact }) => {
    const details = [];
    if (artifact) details.push(`artifact ${artifact}`);
    if (Number.isSafeInteger(capture.statusCode) && capture.statusCode >= 100 && capture.statusCode <= 599) details.push(`status ${capture.statusCode}`);
    const path = plain(capture.finalPath, PATH);
    if (path) details.push(`final path ${path}`);
    const target = plain(capture.targetId, ID) ?? 'unknown target';
    const viewport = plain(capture.viewportId, ID) ?? 'unknown viewport';
    return `test-kit: failed ${target} at ${viewport}: ${code}${details.length ? ` (${details.join(', ')})` : ''}`;
  });
  const more = failures.length - lines.length;
  if (more > 0) lines.push(`test-kit: and ${more} more failed ${more === 1 ? 'cell' : 'cells'}. Read run.json for the rest.`);
  return lines;
}
