// The render part of the `claude-design` provider (R4.6, R5.5). It runs only during `import`.
// It serves the exported canvas under `root/project/` on 127.0.0.1 and renders each mapped artboard in Chromium.
// The context route aborts every HTTP request and closes every WebSocket that does not go to that loopback server.
// WebRTC and WebTransport do not pass the route, so an init script removes them from every frame before any artboard
// script runs, and a proxy that closes every connection guards the browser itself, workers included.
// The canvas runtime (`project/support.js`) is the file the person or the agent saved. This package never ships,
// downloads or vendors it: the server only serves the copy it finds.
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { realpath, open, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { MAX_DESIGN_BYTES, sha256 } from './png.js';
import { PROJECT_DIR, RUNTIME_FILE, RENDER_STATE, STILL_STYLE, NO_SOCKETS_SCRIPT, chromiumArgs, servedPathProblem, contentType, captureClip } from './claude-design-refs.js';

const require = createRequire(import.meta.url);

export { CHROMIUM_ARGS } from './claude-design-refs.js';

const inside = (base, file) => { const offset = relative(base, file); return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset)); };

// Read one file under the real `project/` directory. The real path must stay inside it: `..` and a symlink that
// leaves it are refused. The file must be a regular file of at most `maxBytes` (40 MiB). Errors name the path, never
// its bytes. After the real-path check, a `stat` of that path and the opened handle must agree in device and inode,
// and the real path must be the same again after the open. On POSIX the open also refuses a symbolic link in the
// last name. The bytes it returns are the bytes the caller hashes and serves.
export async function readProjectFile(project, path, what, maxBytes = MAX_DESIGN_BYTES) {
  let file;
  try { file = await realpath(resolve(project, path)); } catch { throw Object.assign(new Error(`The ${what} is missing: ${PROJECT_DIR}/${path}`), { code: 'ENOENT' }); }
  if (!inside(project, file) || file === project) throw Object.assign(new Error(`The ${what} escapes ${PROJECT_DIR}/: ${path}`), { code: 'ESCAPE' });
  let seen, handle;
  try { seen = await stat(file); handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { throw Object.assign(new Error(`The ${what} cannot be opened: ${PROJECT_DIR}/${path}`), { code: 'EOPEN' }); }
  try {
    const info = await handle.stat();
    let again;
    try { again = await realpath(file); } catch { again = null; }
    if (info.dev !== seen.dev || info.ino !== seen.ino || again !== file) throw new Error(`The ${what} changed during the check: ${PROJECT_DIR}/${path}`);
    if (!info.isFile()) throw Object.assign(new Error(`The ${what} is not a regular file: ${PROJECT_DIR}/${path}`), { code: 'NOTFILE' });
    if (info.size > maxBytes) throw new Error(`The ${what} exceeds the file size limit: ${PROJECT_DIR}/${path}`);
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error(`The ${what} exceeds the file size limit: ${PROJECT_DIR}/${path}`);
    return bytes;
  } finally { await handle.close(); }
}

// The caps of the snapshot of `project/`. A hook for tests: no option or key sets them.
export const PROJECT_LIMITS = Object.freeze({ files: 2000, fileBytes: MAX_DESIGN_BYTES, totalBytes: 256 * 1024 * 1024 });

// The sha256 of a snapshot: over the paths in sorted order (UTF-16 code units), one line `<path>\0<sha256>\n` each.
export function projectSha256(files) {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) hash.update(`${path}\0${files.get(path).sha256}\n`);
  return hash.digest('hex');
}

// List the files under the real `project/`, as relative paths with `/`. A name that starts with `.` is skipped: the
// server refuses it. A symbolic link to a directory is not followed. A symbolic link to a file is listed, and the
// read decides. `limits.files` stops the walk early.
async function listProject(project, limits) {
  const paths = [];
  const walk = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        paths.push(path);
        if (paths.length > limits.files) throw new Error(`The ${PROJECT_DIR}/ directory holds more than ${limits.files} files. Export only the canvas project into it.`);
      }
    }
  };
  await walk(project, '');
  return paths.sort();
}

// Check the export and read every file under `project/` once, before any browser or socket starts. The runtime and
// each mapped artboard come first, with their own messages. A symbolic link that leaves `project/`, a link that
// points nowhere and a file that is not a regular file are left out, so the server answers 404 for them, as for any
// other path. A file over the size cap, a file that changes during its check and a snapshot over the count or total
// cap fail the import. The server serves these bytes only, so the hashes in the provenance cover every byte that
// can render.
export async function prepareCanvas(root, artboards, limits = PROJECT_LIMITS) {
  let base;
  try { base = await realpath(root); } catch { throw new Error('The design root does not exist.'); }
  let project;
  try { project = await realpath(join(base, PROJECT_DIR)); } catch { throw new Error(`The claude-design root has no ${PROJECT_DIR}/ directory. Export the canvas project into it.`); }
  if (!inside(base, project) || project === base) throw new Error(`The ${PROJECT_DIR}/ directory escapes the design root.`);
  let runtime;
  try { runtime = await readProjectFile(project, RUNTIME_FILE, 'canvas runtime', limits.fileBytes); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`The claude-design provider needs the canvas runtime at ${PROJECT_DIR}/${RUNTIME_FILE}. Save it from the canvas with the export and run import again. test-kit never ships or downloads it.`);
    throw error;
  }
  const files = new Map([[RUNTIME_FILE, { bytes: runtime, sha256: sha256(runtime) }]]);
  const mapped = new Map();
  for (const path of new Set(artboards)) {
    const bytes = await readProjectFile(project, path, 'artboard', limits.fileBytes);
    mapped.set(path, { bytes, sha256: sha256(bytes) });
    files.set(path, mapped.get(path));
  }
  let total = 0;
  for (const { bytes } of files.values()) total += bytes.length;
  const tooLarge = () => new Error(`The files under ${PROJECT_DIR}/ exceed ${limits.totalBytes} bytes together. Export only the canvas project into it.`);
  if (total > limits.totalBytes) throw tooLarge();
  for (const path of await listProject(project, limits)) {
    if (files.has(path)) continue;
    let bytes;
    try { bytes = await readProjectFile(project, path, 'file', limits.fileBytes); } catch (error) {
      if (['ENOENT', 'ESCAPE', 'EOPEN', 'NOTFILE'].includes(error.code)) continue;
      throw error;
    }
    total += bytes.length;
    if (total > limits.totalBytes) throw tooLarge();
    files.set(path, { bytes, sha256: sha256(bytes) });
  }
  return { project, runtime, runtimeSha256: files.get(RUNTIME_FILE).sha256, artboards: mapped, files, projectSha256: projectSha256(files) };
}

// True when `segment` is the token. The compare takes the same time for every segment of the token length.
export function tokenMatches(segment, token) {
  const given = Buffer.from(String(segment)), expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The loopback server. GET and HEAD only, the Host header must name the server, the first path segment must be the
// random token of this server, and the rest passes `servedPathProblem` and names a file of the snapshot that
// `prepareCanvas` read. It never reads the disk. Any other path is 404, so a local process that finds the port
// cannot read `project/` without the token. No listing, no redirect.
// `requests` counts answered requests. `base` is the origin with the token: the browser loads everything under it.
export async function startCanvasServer(canvas) {
  let port = 0;
  const token = randomBytes(16).toString('hex');
  const stats = { requests: 0, refused: 0 };
  const server = createServer((request, response) => {
    const refuse = (status) => { stats.refused++; response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(); };
    if (!['GET', 'HEAD'].includes(request.method)) return refuse(405);
    if (request.headers.host !== `127.0.0.1:${port}`) return refuse(403);
    const target = String(request.url ?? '');
    if (!target.startsWith('/')) return refuse(400);
    const pathname = target.split(/[?#]/, 1)[0];
    const at = pathname.indexOf('/', 1);
    if (at === -1 || !tokenMatches(pathname.slice(1, at), token)) return refuse(404);
    const { path, problem } = servedPathProblem(pathname.slice(at));
    if (problem) return refuse(404);
    const file = canvas.files.get(path);
    if (!file) return refuse(404);
    const { bytes } = file;
    stats.requests++;
    response.writeHead(200, { 'Content-Type': contentType(path), 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  port = server.address().port;
  return { origin: `http://127.0.0.1:${port}`, port, base: `http://127.0.0.1:${port}/${token}`, stats, close: () => new Promise(done => { server.close(() => done()); server.closeAllConnections(); }) };
}

// The browser-level guard. Chromium sends every connection that is not to the import server through this proxy,
// and the proxy closes each connection at once. It reads nothing and answers nothing. `connections` counts them.
export async function startDeadProxy() {
  const stats = { connections: 0 };
  const sockets = new Set();
  const server = createNetServer(socket => { stats.connections++; sockets.add(socket); socket.on('error', () => {}); socket.destroy(); });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return { port: server.address().port, stats, close: () => new Promise(done => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }) };
}

export async function loadChromium() {
  try {
    const module = await import('@playwright/test');
    const { version } = JSON.parse(await readFile(require.resolve('@playwright/test/package.json'), 'utf8'));
    return { chromium: module.chromium, version };
  } catch {
    throw new Error('The claude-design provider renders in Chromium. Install @playwright/test in the test-kit runtime and run npx playwright install chromium');
  }
}

const artboardUrl = (base, artboard) => `${base}/${artboard.split('/').map(encodeURIComponent).join('/')}`;

// Render one cell. Throws an Error that names the target, the viewport and the reference.
// One deadline of `timeoutMs` covers the whole cell: the new page, the load, the readiness wait, the style tag, the
// font and frame wait, the box read and the screenshot. `page.evaluate` takes no timeout, so the deadline is a timer
// that closes the page and fails the cell. Each step that takes a timeout gets the time left. The readiness wait
// keeps a short reserve, so its diagnostic read still runs before the deadline.
async function renderCell(context, base, { target, viewport, artboard, selector, source }, timeoutMs) {
  const name = `target ${target.id}, viewport ${viewport.id}: ${source}`;
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  const reserve = Math.min(500, Math.floor(timeoutMs / 4));
  let page, timer, expired = false, scriptError = false;
  // An artboard that navigates the top page destroys the document that the steps read. Each step then fails with a
  // Playwright message, and a new document can render and pass. A random mark on the loaded document tells the two
  // documents apart, so the cell fails with one message that names it.
  const mark = `testKitArtboard${randomBytes(8).toString('hex')}`;
  const away = () => new Error(`Artboard navigated away for ${name}. An artboard must not navigate the top page.`);
  const sameDocument = () => page.evaluate(key => window[key] === true, mark).catch(() => false);
  const late = new Promise((_, fail) => {
    timer = setTimeout(() => {
      expired = true;
      page?.close().catch(() => {});
      fail(new Error(`Artboard did not finish within ${timeoutMs} ms (screenshot.timeoutMs) for ${name}.`));
    }, timeoutMs);
  });
  const steps = async () => {
    page = await context.newPage();
    if (expired) { await page.close().catch(() => {}); return null; }
    page.on('pageerror', () => { scriptError = true; });
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    let response;
    try { response = await page.goto(artboardUrl(base, artboard), { waitUntil: 'load', timeout: left() }); } catch { throw new Error(`Artboard did not load for ${name}.`); }
    if (!response || response.status() !== 200) throw new Error(`Artboard did not load for ${name} (HTTP ${response?.status() ?? 'none'}).`);
    try { await page.evaluate(key => { window[key] = true; }, mark); } catch { throw away(); }
    try { return await settled(); } catch (error) {
      if (!expired && !(await sameDocument())) throw away();
      throw error;
    }
  };
  const settled = async () => {
    try {
      await page.waitForFunction(`(() => { const state = ${RENDER_STATE}; return !state.holes && !state.emptyImports; })()`, null, { timeout: Math.max(1, left() - reserve), polling: 100 });
    } catch {
      let state = null;
      try { state = await page.evaluate(RENDER_STATE); } catch { /* The page is gone. The message below still names the cell. */ }
      const reasons = [];
      if (!state || state.holes) reasons.push('a "{{" hole is still in the text');
      if (state?.emptyImports) reasons.push(`${state.emptyImports} x-import element(s) are empty`);
      throw new Error(`Artboard did not render for ${name}: ${reasons.join(' and ')} within ${timeoutMs} ms.${scriptError ? ' The page reported a script error.' : ''} Check that ${PROJECT_DIR}/${RUNTIME_FILE} is the canvas runtime of this export.`);
    }
    await page.addStyleTag({ content: STILL_STYLE });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
    let box;
    if (selector === null) box = await page.evaluate(() => ({ top: 0, bottom: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) }));
    else {
      const found = await page.evaluate(value => {
        let matches;
        try { matches = document.querySelectorAll(value); } catch { return { invalid: true }; }
        if (matches.length !== 1) return { count: matches.length };
        const rect = matches[0].getBoundingClientRect();
        return { count: 1, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
      }, selector);
      if (found.invalid) throw new Error(`The selector of ${name} is not valid CSS.`);
      if (found.count !== 1) {
        // The text after the first "#" is the whole CSS selector, so an element ID needs its own "#".
        const hint = found.count === 0 && /^[A-Za-z][\w-]*$/.test(selector) ? ` For the element with the ID "${selector}", write "${artboard}##${selector}".` : '';
        throw new Error(`The selector of ${name} matches ${found.count} elements. It must match exactly one.${hint}`);
      }
      box = found;
    }
    const clip = captureClip(viewport.width, box);
    if (!clip) throw new Error(`The artboard area of ${name} has no height.`);
    const bytes = await page.screenshot({ type: 'png', clip, fullPage: true, animations: 'disabled', caret: 'hide', timeout: left() });
    if (!(await sameDocument())) throw away();
    return bytes;
  };
  try {
    return await Promise.race([steps(), late]);
  } finally {
    clearTimeout(timer);
    // After the deadline the timer has already asked the page to close. Waiting for that close could hang too.
    if (!expired) await page?.close().catch(() => {});
  }
}

// Render every cell. One browser, one context for each viewport, one page for each cell. All-or-nothing:
// the first failure throws, and the caller writes no run. `chromium` is a test hook.
export async function renderCanvas({ canvas, cells, timeoutMs, chromium }) {
  const browserType = chromium ?? (await loadChromium()).chromium;
  const server = await startCanvasServer(canvas);
  let browser, proxy;
  let blocked = 0;
  try {
    proxy = await startDeadProxy();
    browser = await browserType.launch({ headless: true, args: chromiumArgs(server.port, proxy.port) });
    const images = [];
    const viewports = [...new Map(cells.map(cell => [cell.viewport.id, cell.viewport])).values()];
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
      try {
        // WebRTC goes past the route (a TURN server over TCP), so it is gone before any artboard script runs.
        await context.addInitScript(NO_SOCKETS_SCRIPT);
        await context.routeWebSocket('**/*', socket => socket.close());
        // Only the loopback server under its token answers an HTTP request. Every other one is aborted.
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(`${server.base}/`)) return route.continue();
          blocked++;
          return route.abort('blockedbyclient');
        });
        for (const cell of cells.filter(item => item.viewport.id === viewport.id)) images.push({ ...cell, bytes: await renderCell(context, server.base, cell, timeoutMs) });
      } finally { await context.close().catch(() => {}); }
    }
    return { images, blocked, served: server.stats.requests, version: browser.version() };
  } finally {
    await browser?.close().catch(() => {});
    await proxy?.close();
    await server.close();
  }
}
