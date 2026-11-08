// The render part of the `claude-design` provider (R4.6, R5.5). It runs only during `import`.
// It serves the exported canvas under `root/project/` on 127.0.0.1 and renders each mapped artboard in Chromium.
// Every request that does not go to that loopback server is aborted, so no connection leaves the machine.
// The canvas runtime (`project/support.js`) is the file the person or the agent saved. This package never ships,
// downloads or vendors it: the server only serves the copy it finds.
import { createServer } from 'node:http';
import { realpath, open, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { MAX_DESIGN_BYTES, sha256 } from './png.js';
import { PROJECT_DIR, RUNTIME_FILE, RENDER_STATE, STILL_STYLE, servedPathProblem, contentType, captureClip } from './claude-design-refs.js';

const require = createRequire(import.meta.url);

// Chromium switches that close the gaps a request route does not see. A host name never resolves, so a
// preconnect or a prefetch cannot reach a remote host. WebRTC uses no direct UDP. The route below is the main guard.
export const CHROMIUM_ARGS = Object.freeze(['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);

const inside = (base, file) => { const offset = relative(base, file); return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset)); };

// Read one file under the real `project/` directory. The real path must stay inside it: `..` and a symlink that
// leaves it are refused. The file must be a regular file of at most 40 MiB. Errors name the path, never its bytes.
export async function readProjectFile(project, path, what) {
  let file;
  try { file = await realpath(resolve(project, path)); } catch { throw Object.assign(new Error(`The ${what} is missing: ${PROJECT_DIR}/${path}`), { code: 'ENOENT' }); }
  if (!inside(project, file) || file === project) throw new Error(`The ${what} escapes ${PROJECT_DIR}/: ${path}`);
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`The ${what} is not a regular file: ${PROJECT_DIR}/${path}`);
    if (info.size > MAX_DESIGN_BYTES) throw new Error(`The ${what} exceeds the file size limit: ${PROJECT_DIR}/${path}`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_DESIGN_BYTES) throw new Error(`The ${what} exceeds the file size limit: ${PROJECT_DIR}/${path}`);
    return bytes;
  } finally { await handle.close(); }
}

// Check the export and read the runtime and every mapped artboard once. The server serves these bytes, so the
// hashes in the provenance are the hashes of what rendered. Nothing here opens a browser or a socket.
export async function prepareCanvas(root, artboards) {
  let base;
  try { base = await realpath(root); } catch { throw new Error('The design root does not exist.'); }
  let project;
  try { project = await realpath(join(base, PROJECT_DIR)); } catch { throw new Error(`The claude-design root has no ${PROJECT_DIR}/ directory. Export the canvas project into it.`); }
  if (!inside(base, project) || project === base) throw new Error(`The ${PROJECT_DIR}/ directory escapes the design root.`);
  let runtime;
  try { runtime = await readProjectFile(project, RUNTIME_FILE, 'canvas runtime'); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`The claude-design provider needs the canvas runtime at ${PROJECT_DIR}/${RUNTIME_FILE}. Save it from the canvas with the export and run import again. test-kit never ships or downloads it.`);
    throw error;
  }
  const files = new Map();
  for (const path of new Set(artboards)) {
    const bytes = await readProjectFile(project, path, 'artboard');
    files.set(path, { bytes, sha256: sha256(bytes) });
  }
  return { project, runtime, runtimeSha256: sha256(runtime), artboards: files };
}

// The loopback server. GET and HEAD only, the Host header must name the server, the path passes
// `servedPathProblem` and then the real-path check. No listing, no redirect. `requests` counts answered requests.
export async function startCanvasServer(canvas) {
  let port = 0;
  const stats = { requests: 0, refused: 0 };
  const server = createServer(async (request, response) => {
    const refuse = (status) => { stats.refused++; response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(); };
    if (!['GET', 'HEAD'].includes(request.method)) return refuse(405);
    if (request.headers.host !== `127.0.0.1:${port}`) return refuse(403);
    const target = String(request.url ?? '');
    if (!target.startsWith('/')) return refuse(400);
    const { path, problem } = servedPathProblem(target.split(/[?#]/, 1)[0]);
    if (problem) return refuse(404);
    let bytes;
    if (path === RUNTIME_FILE) bytes = canvas.runtime;
    else if (canvas.artboards.has(path)) bytes = canvas.artboards.get(path).bytes;
    else {
      try { bytes = await readProjectFile(canvas.project, path, 'file'); } catch { return refuse(404); }
    }
    stats.requests++;
    response.writeHead(200, { 'Content-Type': contentType(path), 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  port = server.address().port;
  return { origin: `http://127.0.0.1:${port}`, stats, close: () => new Promise(done => { server.close(() => done()); server.closeAllConnections(); }) };
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

const artboardUrl = (origin, artboard) => `${origin}/${artboard.split('/').map(encodeURIComponent).join('/')}`;

// Render one cell. Throws an Error that names the target, the viewport and the reference.
async function renderCell(context, origin, { target, viewport, artboard, selector, source }, timeoutMs) {
  const name = `target ${target.id}, viewport ${viewport.id}: ${source}`;
  const page = await context.newPage();
  let scriptError = false;
  page.on('pageerror', () => { scriptError = true; });
  try {
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    let response;
    try { response = await page.goto(artboardUrl(origin, artboard), { waitUntil: 'load' }); } catch { throw new Error(`Artboard did not load for ${name}.`); }
    if (!response || response.status() !== 200) throw new Error(`Artboard did not load for ${name} (HTTP ${response?.status() ?? 'none'}).`);
    try {
      await page.waitForFunction(`(() => { const state = ${RENDER_STATE}; return !state.holes && !state.emptyImports; })()`, null, { timeout: timeoutMs, polling: 100 });
    } catch {
      let state = null;
      try { state = await page.evaluate(RENDER_STATE); } catch { /* The page is gone. The message below still names the cell. */ }
      const reasons = [];
      if (!state || state.holes) reasons.push('a "{{" hole is still in the text');
      if (state?.emptyImports) reasons.push(`${state.emptyImports} x-import element(s) are empty`);
      throw new Error(`Artboard did not render for ${name}: ${reasons.join(' and ')} after ${timeoutMs} ms.${scriptError ? ' The page reported a script error.' : ''} Check that ${PROJECT_DIR}/${RUNTIME_FILE} is the canvas runtime of this export.`);
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
    return await page.screenshot({ type: 'png', clip, fullPage: true, animations: 'disabled', caret: 'hide' });
  } finally {
    await page.close().catch(() => {});
  }
}

// Render every cell. One browser, one context for each viewport, one page for each cell. All-or-nothing:
// the first failure throws, and the caller writes no run. `chromium` is a test hook.
export async function renderCanvas({ canvas, cells, timeoutMs, chromium }) {
  const browserType = chromium ?? (await loadChromium()).chromium;
  const server = await startCanvasServer(canvas);
  let browser;
  let blocked = 0;
  try {
    browser = await browserType.launch({ headless: true, args: [...CHROMIUM_ARGS] });
    const images = [];
    const viewports = [...new Map(cells.map(cell => [cell.viewport.id, cell.viewport])).values()];
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false });
      try {
        await context.routeWebSocket('**/*', socket => socket.close());
        // Offline by construction: only the loopback server answers. Everything else is aborted.
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url === server.origin || url.startsWith(`${server.origin}/`)) return route.continue();
          blocked++;
          return route.abort('blockedbyclient');
        });
        for (const cell of cells.filter(item => item.viewport.id === viewport.id)) images.push({ ...cell, bytes: await renderCell(context, server.origin, cell, timeoutMs) });
      } finally { await context.close().catch(() => {}); }
    }
    return { images, blocked, served: server.stats.requests, version: browser.version() };
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
}
