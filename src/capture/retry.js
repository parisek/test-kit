import { CAPTURE_RETRIED } from '../report/warnings.js';

// R5.14: bounded transient retries of one capture cell. Pure: no DOM, no file system, no browser.
// The allowlist is closed. An error that is not on it is never retried.
export const RETRIES_MAX = 2;
export const RETRY_WAIT_MS = 1000;
export const DEADLINE_CODE = 'CAPTURE_DEADLINE';

// The Chromium network errors that a second try can fix (ADR 0009). Playwright reports them as `net::ERR_*`.
export const TRANSIENT_NET_ERRORS = Object.freeze([
  'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT', 'ERR_EMPTY_RESPONSE', 'ERR_NETWORK_CHANGED',
]);

// The phases in which a retry may run. A failure in the content, behavior or pack phase never retries.
const RETRY_PHASES = new Set(['navigation', 'settlement', 'screenshot']);

// The error of the whole-capture deadline. The code makes it recognizable without its text.
export function deadlineError() {
  const error = new Error('Capture deadline exceeded');
  error.code = DEADLINE_CODE;
  return error;
}

export function chromiumNetError(error) {
  const found = /\bnet::(ERR_[A-Z0-9_]+)/.exec(String(error?.message ?? ''));
  return found ? found[1] : null;
}

// The result of one failed attempt: is a second try worth it?
// `edge`, `blocked` and `unexpectedNavigation` are the flags that `captureOne` tracks. Any of them wins over the text.
// `statusCode` is the status of the page response, when there was one. A 4xx or 5xx page is a result, not a fault.
export function isTransientFailure({ error, edge = null, blocked = false, unexpectedNavigation = false, phase, statusCode } = {}) {
  if (edge || blocked || unexpectedNavigation) return false;
  if (!RETRY_PHASES.has(phase)) return false;
  if (Number.isInteger(statusCode) && statusCode >= 400) return false;
  if (!error || typeof error !== 'object') return false;
  if (error.code === DEADLINE_CODE) return true;
  if (error.name === 'TimeoutError') return true;
  const net = chromiumNetError(error);
  return net !== null && TRANSIENT_NET_ERRORS.includes(net);
}

// A failed `route.fetch` of a top-level navigation reaches the page as `net::ERR_FAILED`, so the Chromium name is lost.
// This maps the Node error text to the Playwright abort code that Chromium reports as the same class of fault.
// Only the two transient classes map. Every other fetch error keeps `failed`.
export function navigationAbortCode(error) {
  const text = String(error?.message ?? '');
  if (/\bECONNRESET\b|socket hang up|\bEPIPE\b/.test(text)) return 'connectionreset';
  if (/^route\.fetch: aborted$/.test(text.trim())) return 'connectionclosed';
  return 'failed';
}

// The retries flag: an integer from 0 to 2. The value may be a number or a digit string.
export function parseRetries(value) {
  if (value === undefined || value === null) return 0;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number < 0 || number > RETRIES_MAX) throw new Error(`--retries must be 0..${RETRIES_MAX}`);
  return number;
}

// The wait before attempt n + 1, in ms. No jitter.
export const retryWait = attempt => RETRY_WAIT_MS * attempt;

// The mark that `captureOne` puts on a failed entry. It is not enumerable, so it never reaches `run.json`.
export function markTransient(entry, transient) {
  Object.defineProperty(entry, 'transient', { value: transient === true, enumerable: false });
  return entry;
}

// Run one cell with at most `retries` more tries. `attempt()` returns an entry.
// A captured entry that needed retries gets the warning. A failed entry that used retries names the attempts.
export async function captureWithRetries(attempt, { retries = 0, sleep, addWarning }) {
  let tries = 0;
  while (true) {
    tries += 1;
    const entry = await attempt();
    if (entry.state === 'captured') return tries > 1 ? addWarning(entry, { code: CAPTURE_RETRIED, count: tries - 1 }) : entry;
    if (tries > retries || entry.transient !== true) {
      if (tries > 1) return { ...entry, error: { ...entry.error, message: `${entry.error.message} The capture tried ${tries} times.` } };
      return entry;
    }
    await sleep(retryWait(tries));
  }
}
