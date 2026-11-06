// Pure guards for the paths of a design side (R5.5). Paths come from the configuration, so they are untrusted.
// No file system here (R4.4). `readDesignFile` in `import.js` adds the real-path check.
export const MAX_DESIGN_PATH = 300;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

// The reason a path under `root` is not accepted, or null. A path is plain, relative and ends in `.png`.
// No `..`, no `.`, no empty segment, no absolute path, no drive letter, no backslash, no control character.
export function designPathProblem(value) {
  if (typeof value !== 'string' || !value.length) return 'must be text';
  if (value.length > MAX_DESIGN_PATH) return `must be at most ${MAX_DESIGN_PATH} characters`;
  if (/[\x00-\x1f\x7f\\]/.test(value)) return 'must hold no control character or backslash';
  if (value.startsWith('/')) return 'must be relative';
  const parts = value.split('/');
  if (parts.some(part => !SEGMENT.test(part))) return 'must be a plain relative path (letters, digits, "_", "-", "."; no "..")';
  if (!value.endsWith('.png')) return 'must end in ".png"';
  return null;
}

// The `root` of a side: a plain relative directory path, as `runsRoot` is.
export function designRootProblem(value) {
  if (typeof value !== 'string' || !value.length || value.length > 500) return 'must be bounded text';
  if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) return 'must be a plain relative path';
  return null;
}
