// Pure guards for the `claude-design` provider (R5.5, R4.4). An artboard reference comes from the configuration
// and a request path comes from the browser, so both are untrusted text. No network and no file system here.
import { MAX_DESIGN_PATH } from './paths.js';

// The export layout under `root`. The canvas files live in `project/`. The canvas runtime is the file the
// person or the agent saved as `project/support.js`. The package never ships, downloads or vendors it.
export const PROJECT_DIR = 'project';
export const RUNTIME_FILE = 'support.js';
export const ARTBOARD_SUFFIX = '.dc.html';
export const MAX_SELECTOR = 2048;
export const MAX_SERVED_PATH = 1024;

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

// An artboard reference is `<name>.dc.html` or `<name>.dc.html#<selector>`. The name is one file directly in `project/`,
// because an artboard loads `./support.js` beside itself and the server serves the runtime at `/support.js` only.
// The path characters exclude `#`, so the first `#` ends the path and the selector may hold more (`A.dc.html##hero`).
// Returns `{ artboard, selector }` (selector is null for the full artboard), or `{ problem }`.
export function parseArtboardRef(value) {
  if (typeof value !== 'string' || !value.length) return { problem: 'must be text' };
  const at = value.indexOf('#');
  const artboard = at === -1 ? value : value.slice(0, at);
  const selector = at === -1 ? null : value.slice(at + 1);
  if (artboard.length > MAX_DESIGN_PATH) return { problem: `must name an artboard path of at most ${MAX_DESIGN_PATH} characters` };
  if (/[\x00-\x1f\x7f]/.test(value)) return { problem: 'must hold no control character' };
  // A selector may hold a backslash escape (`.md\:flex`). The artboard path may not.
  if (artboard.includes('\\')) return { problem: 'must name an artboard path with no backslash' };
  if (artboard.startsWith('/')) return { problem: 'must be relative to project/' };
  if (artboard.includes('/')) return { problem: 'must name an artboard file directly in project/ (no "/")' };
  if (!SEGMENT.test(artboard)) return { problem: 'must name a plain artboard file name (letters, digits, "_", "-", "."; no "..")' };
  if (!artboard.endsWith(ARTBOARD_SUFFIX) || artboard === ARTBOARD_SUFFIX) return { problem: `must name an artboard file that ends in "${ARTBOARD_SUFFIX}"` };
  if (selector !== null) {
    if (!selector.trim()) return { problem: 'must have a CSS selector after "#"' };
    if (selector.length > MAX_SELECTOR) return { problem: `must have a CSS selector of at most ${MAX_SELECTOR} characters` };
  }
  return { artboard, selector };
}

// The reason a reference is refused, or null.
export function artboardRefProblem(value) {
  return parseArtboardRef(value).problem ?? null;
}

// A request path of the loopback server, as the URL pathname (percent-encoded). Returns `{ path }`, the decoded
// relative path, or `{ problem }`. The real-path check in `claude-design.js` is the second guard.
// Refused: an empty or a `.` or `..` segment, a hidden name (leading `.`), a backslash, a control character,
// a `/` or NUL hidden in a percent escape, and a path that does not decode.
export function servedPathProblem(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.length > MAX_SERVED_PATH) return { problem: 'bad path' };
  const parts = pathname.slice(1).split('/');
  const decoded = [];
  for (const part of parts) {
    let value;
    try { value = decodeURIComponent(part); } catch { return { problem: 'bad escape' }; }
    if (!value.length || value === '.' || value === '..' || value.startsWith('.')) return { problem: 'bad segment' };
    if (/[\x00-\x1f\x7f\\/]/.test(value)) return { problem: 'bad character' };
    decoded.push(value);
  }
  return { path: decoded.join('/') };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

// The content type of a served file, by its extension. Anything else is opaque bytes.
export function contentType(path) {
  const name = String(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? undefined : TYPES[name.slice(dot)]) ?? 'application/octet-stream';
}

// The style that stops motion before the screenshot, as the local side does with `disableMotion`.
export const STILL_STYLE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

// The readiness test runs in the page. It is a string, so this file stays free of DOM code.
// Ready: the body text holds no `{{`, and every `x-import` element has a child or a shadow root.
// The text of each open shadow root counts too. Returns `{ holes, emptyImports }`.
export const RENDER_STATE = `(() => {
  const body = document.body;
  if (!body) return { holes: true, emptyImports: 0 };
  let holes = body.innerText.includes('{{');
  const visit = root => {
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      for (const child of element.shadowRoot.children) if (typeof child.innerText === 'string' && child.innerText.includes('{{')) holes = true;
      visit(element.shadowRoot);
    }
  };
  visit(document);
  const emptyImports = [...document.querySelectorAll('x-import')].filter(element => !element.children.length && !element.shadowRoot).length;
  return { holes, emptyImports };
})()`;

// The page rectangle of the screenshot, in CSS pixels. The band always starts at x = 0 and is the viewport wide,
// so the image is viewport width x device scale wide by construction (R8.15). Full artboard: from the top to the
// document height. With a selector: the top and the height of the one matched element.
export function captureClip(viewportWidth, box) {
  const top = Math.max(0, Math.floor(box.top));
  const bottom = Math.ceil(box.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom - top < 1) return null;
  return { x: 0, y: top, width: viewportWidth, height: bottom - top };
}
