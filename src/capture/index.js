import { mkdir, writeFile, rename, readFile, access, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, captureSettings, settingsHash } from '../config/index.js';
import { isLocalUrl, createRunId, assertImageBounds, targetPath, ddevMatchesOrigin } from './helpers.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const BROWSER_SETTINGS = Object.freeze({ name: 'chromium', headless: true, ignoreHTTPSErrors: true, serviceWorkers: 'block', webSockets: 'block' });

async function writeManifest(path, run) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function projectRoot(directory) {
  let current = directory;
  while (true) {
    try { await access(join(current, '.ddev')); return current; } catch { /* Check the next ancestor. */ }
    const parent = dirname(current);
    if (parent === current) throw new Error('A DDEV origin requires a project with a .ddev directory');
    current = parent;
  }
}

async function gitSha(directory) {
  try {
    const { stdout } = await execute('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: directory, timeout: 10000 });
    const sha = stdout.trim();
    if (/^[a-f0-9]{7,40}$/.test(sha)) return sha;
  } catch { /* A configuration can live outside a Git repository. */ }
  return '0000000';
}

async function playwright() {
  try {
    const module = await import('@playwright/test');
    const path = require.resolve('@playwright/test/package.json');
    const { version } = JSON.parse(await readFile(path, 'utf8'));
    return { chromium: module.chromium, version };
  } catch {
    throw new Error('Install @playwright/test in the test-kit runtime and run npx playwright install chromium');
  }
}

async function captureOne(browser, config, side, target, viewport, runDir) {
  const identity = { targetId: target.id, viewportId: viewport.id };
  const recipe = config.sides[side].settle;
  let context;
  let blocked = false;
  let phase = 'navigation';
  const relativePath = `screenshots/${target.id}/${viewport.id}.png`;
  const file = resolve(runDir, relativePath);
  let timer;
  let expired = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('Capture deadline exceeded')); }, config.screenshot.timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor,
      ignoreHTTPSErrors: BROWSER_SETTINGS.ignoreHTTPSErrors, serviceWorkers: BROWSER_SETTINGS.serviceWorkers,
      reducedMotion: recipe.disableMotion ? 'reduce' : 'no-preference',
    });
    if (expired) { await context.close(); throw new Error('Capture deadline exceeded'); }
    if (typeof context.routeWebSocket !== 'function') throw new Error('Playwright WebSocket routing is unavailable');
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(config.screenshot.timeoutMs);
    page.setDefaultNavigationTimeout(config.screenshot.timeoutMs);
    await context.route('**/*', async route => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method()) || !isLocalUrl(request.url())) {
        blocked = true;
        await route.abort('blockedbyclient');
      } else {
        // Fetch one response without following redirects. Check Location before
        // the browser can issue a request to its destination.
        try {
          const response = await route.fetch({ maxRedirects: 0, timeout: config.screenshot.timeoutMs });
          const location = response.headers().location;
          if (response.status() >= 300 && response.status() < 400 && location
            && !isLocalUrl(new URL(location, request.url()).href)) {
            blocked = true;
            await route.abort('blockedbyclient');
          } else await route.fulfill({ response });
        } catch {
          await route.abort('failed').catch(() => {});
        }
      }
    });
    const url = new URL(targetPath(target, side), config.sides[side].origin);
    if (!isLocalUrl(url.href)) throw new Error('Nonlocal navigation');
    const response = await page.goto(url.href, { waitUntil: 'load' });
    if (!response) throw new Error('No HTTP navigation response');
    phase = 'settlement';
    for (const selector of recipe.selectors) await page.locator(selector).first().waitFor({ state: 'visible' });
    await page.evaluate(async () => { await document.fonts.ready; });
    if (recipe.waitMs) await page.waitForTimeout(recipe.waitMs);
    if (blocked || !isLocalUrl(page.url())) throw new Error('Nonlocal navigation');
    phase = 'screenshot';
    let locator;
    let size;
    if (target.selector) {
      locator = page.locator(target.selector).first();
      await locator.waitFor({ state: 'visible' });
      size = await locator.boundingBox();
      if (!size) throw new Error('Selector has no visible area');
    } else {
      size = config.screenshot.fullPage ? await page.evaluate(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, innerWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight),
      })) : { width: viewport.width, height: viewport.height };
    }
    assertImageBounds(size.width, size.height, viewport.deviceScaleFactor);
    await mkdir(dirname(file), { recursive: true });
    const options = { path: file, type: 'png', timeout: config.screenshot.timeoutMs,
      animations: recipe.disableMotion ? 'disabled' : 'allow', mask: recipe.masks.map(selector => page.locator(selector)) };
    const bytes = locator ? await locator.screenshot(options) : await page.screenshot({ ...options, fullPage: config.screenshot.fullPage });
    // Verify actual PNG dimensions as well as the pre-capture estimate.
    if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid screenshot PNG');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assertImageBounds(width, height);
    if (blocked || !isLocalUrl(page.url())) throw new Error('Nonlocal navigation');
    const final = new URL(page.url());
    return { ...identity, state: 'captured', path: relativePath, statusCode: response.status(), finalPath: final.pathname,
      width, height, deviceScaleFactor: viewport.deviceScaleFactor };
    })()]);
  } catch {
    if (context) await context.close().catch(() => {});
    await unlink(file).catch(() => {});
    return { ...identity, state: 'failed', error: { code: blocked ? 'LOCAL_NAVIGATION_REQUIRED' : `CAPTURE_${phase.toUpperCase()}_FAILED`,
      message: blocked ? 'A request leaves the local environment or submits data' : `The ${phase} step fails. Check the local page and capture recipe.` } };
  } finally { clearTimeout(timer); if (context) await context.close().catch(() => {}); }
}

export async function capture({ configPath, side, label = '', runsRoot }) {
  const loaded = await loadConfig(configPath);
  const { config } = loaded;
  if (!Object.hasOwn(config.sides, side)) throw new Error(`Unknown side: ${side}`);
  if (typeof label !== 'string' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Run label must be bounded text');
  const tool = await playwright();
  if (new URL(config.sides[side].origin).hostname.endsWith('.ddev.site')) {
    const cwd = await projectRoot(loaded.configDir);
    let description;
    try {
      const { stdout } = await execute('ddev', ['describe', '--json-output'], { cwd, timeout: 30000 });
      description = JSON.parse(stdout);
    } catch { throw new Error('Cannot verify the DDEV project for the configured origin'); }
    if (!ddevMatchesOrigin(description, config.sides[side].origin)) throw new Error('The nearest DDEV checkout does not serve the configured origin');
    try { await execute('ddev', ['mutagen', 'sync'], { cwd, timeout: 60000 }); }
    catch { throw new Error('ddev mutagen sync fails. Fix DDEV synchronization before capture.'); }
  }
  const at = new Date();
  const id = createRunId(at, process.pid, await gitSha(loaded.configDir));
  const root = runsRoot ? resolve(loaded.configDir, runsRoot) : loaded.runsRoot;
  const runDir = join(root, id);
  await mkdir(root, { recursive: true });
  await mkdir(runDir);
  const manifestPath = join(runDir, 'run.json');
  const effectiveSettings = { ...captureSettings(config, side), browser: BROWSER_SETTINGS };
  const hash = settingsHash(effectiveSettings);
  const run = { schemaVersion: 2, id, side, label, at: at.toISOString(), state: 'partial', settings: config,
    captureSettings: effectiveSettings, settingsHash: hash, tools: [{ name: 'playwright', version: tool.version, settingsHash: hash }], captures: [] };
  await writeManifest(manifestPath, run);
  let browser;
  try {
    browser = await tool.chromium.launch({ headless: true });
    const probe = await browser.newContext();
    try {
      if (typeof probe.routeWebSocket !== 'function') {
        const error = new Error('Playwright 1.49 or newer is required for local-only WebSocket guards');
        error.code = 'PLAYWRIGHT_VERSION_UNSUPPORTED';
        throw error;
      }
    } finally { await probe.close(); }
    run.tools.push({ name: 'chromium', version: browser.version(), settingsHash: hash });
    await writeManifest(manifestPath, run);
    for (const target of config.targets) for (const viewport of config.viewports) {
      run.captures.push(await captureOne(browser, config, side, target, viewport, runDir));
      await writeManifest(manifestPath, run);
    }
    if (run.captures.every(result => result.state === 'captured')) run.state = 'complete';
    await writeManifest(manifestPath, run);
  } catch (error) {
    if (error.code === 'PLAYWRIGHT_VERSION_UNSUPPORTED') throw error;
    throw new Error(`Capture stops before completion. Evidence remains in ${manifestPath}. Check Chromium installation and local browser resources.`);
  } finally { if (browser) await browser.close(); }
  return { run, runDir, manifestPath };
}
