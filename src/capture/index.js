import { settlePage, countUnloadedLazyImages, afterSweepError } from './settle.js';
import { captureWarnings, warningFields, withWarning } from '../report/warnings.js';
import { captureScopedScreenshot } from './scope.js';
import { captureRecipe, settleRecipe } from '../config/settings.js';
import { runBehavior, loadBehaviorSource, BEHAVIOR_VERSION } from '../behavior/index.js';
import { gzipSync } from 'node:zlib';
import { extractContentSnapshot } from '../content/extract.js';
import { contentSettings } from '../config/settings.js';
import { responseSettings } from '../config/settings.js';
import { storeResponse } from '../artifacts/response.js';
import { mkdir, writeFile, rename, readFile, access, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { ensureDefaultRunsIgnore } from '../config/store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readComponents } from '../styleguide/index.js';
import { loadConfig, normalizeConfig, captureSettings, settingsHash } from '../config/index.js';
import { recordSelection, cellSelected } from './selection.js';
import { isLocalUrl, isOwnOrigin, isAllowedOriginRequest, allowedOriginFailure, allowedOriginStatusFailure, decideRequest, redirectPermitted, describeBlockedRequest, blockedRequestMessage, createDroppedLog, droppedFields, edgeStop, userAgentOption, createRunId, assertImageBounds, targetPath, ddevMatchesOrigin, ddevStatusProblem } from './helpers.js';
import { planPackRun } from '../packs/select.js';
import { runPagePacks } from './packs.js';
import { gitSha } from './git.js';
import { createKeepFinder } from './keep-store.js';
import { DEADLINE_CODE, deadlineError, isTransientFailure, markTransient, navigationAbortCode, captureWithRetries, parseRetries } from './retry.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const BROWSER_SETTINGS = Object.freeze({ name: 'chromium', headless: true, ignoreHTTPSErrors: true, serviceWorkers: 'block', webSockets: 'block' });
// A local DDEV certificate is self-signed, so a local side ignores certificate errors.
// A remote side verifies the certificate: an invalid one is a defect to see, not to skip.
// Only the context option differs. The recorded settings and their hashes stay the same,
// so a remote run stays comparable with a local run: certificate checks do not change pixels.
const ignoreHTTPSErrors = (config, side) => config.sides[side].remote !== true;

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

async function playwright() {
  try {
    const module = await import('@playwright/test');
    const path = require.resolve('@playwright/test/package.json');
    const { version } = JSON.parse(await readFile(path, 'utf8'));
    return { chromium: module.chromium, request: module.request, version };
  } catch {
    throw new Error('Install @playwright/test in the test-kit runtime and run npx playwright install chromium');
  }
}

// The provenance of the artifacts of one target. The content settings depend on the target.
function targetProvenance(config, side, target, provenance) {
  if (!provenance.content) return provenance;
  return { ...provenance, content: { ...provenance.content, settingsHash: settingsHash({ ...contentSettings(config, side, target), browser: BROWSER_SETTINGS }) } };
}

async function captureOne(browser, config, side, target, viewport, runDir, provenance, behaviorSource, packRun = null) {
  const recipe = settleRecipe(config, side, target);
  const identity = { targetId: target.id, viewportId: viewport.id, settleHash: settingsHash(recipe) };
  // R5.6: a captured entry stores its effective recipe, also when it is the default. Its parts hash to `scopeHash` and `settleHash`.
  const stored = () => {
    const effective = captureRecipe(config, side, target);
    return { scopeHash: settingsHash(effective.scope), recipe: effective };
  };
  const remote = config.sides[side].remote === true;
  const allowedUrl = value => remote ? isOwnOrigin(value, config.sides[side].origin) : isLocalUrl(value);
  provenance = targetProvenance(config, side, target, provenance);
  let artifacts = {};
  let statusCode;
  let finalPath;
  let unexpectedNavigation = false;
  let context;
  let verifier;
  let blocked = false;
  // The first blocked request, for the error text. Later ones do not replace it.
  let firstBlocked = null;
  // R3.8: the requests a remote side aborts and keeps the capture.
  const droppedLog = createDroppedLog();
  // R3.6: the reason a remote edge challenges or limits the capture. It stops the run.
  let edge = null;
  let phase = 'navigation';
  const relativePath = `screenshots/${target.id}/${viewport.id}.png`;
  const file = resolve(runDir, relativePath);
  let timer;
  let expired = false;
  const settleProgress = {};
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(deadlineError()); }, config.screenshot.timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor,
      ignoreHTTPSErrors: ignoreHTTPSErrors(config, side), ...userAgentOption(config.sides[side]), serviceWorkers: BROWSER_SETTINGS.serviceWorkers,
      reducedMotion: config.artifacts.includes('behavior') ? config.behavior.emulate.reducedMotion ?? (recipe.disableMotion ? 'reduce' : 'no-preference') : recipe.disableMotion ? 'reduce' : 'no-preference',
      ...(config.artifacts.includes('behavior') && config.behavior.emulate.colorScheme ? { colorScheme: config.behavior.emulate.colorScheme } : {}),
    });
    // R3.9: a local context ignores certificate errors, so an allowed origin gets a verifying context.
    if (config.sides[side].allowOrigins?.length && ignoreHTTPSErrors(config, side)) verifier = await browser.newContext({ ignoreHTTPSErrors: false });
    if (expired) { await context.close(); await verifier?.close().catch(() => {}); throw deadlineError(); }
    if (typeof context.routeWebSocket !== 'function') throw new Error('Playwright WebSocket routing is unavailable');
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    context.on('page', extra => {
      if ((recipe.reveal?.length || recipe.lazyImages) && phase !== 'behavior') {
        unexpectedNavigation = true;
        extra.close().catch(() => {});
      }
    });
    const assets = { requests: 0, failed: 0, httpErrors: 0 };
    page.on('request', request => { if (!request.isNavigationRequest()) assets.requests++; });
    page.on('requestfailed', request => { if (!request.isNavigationRequest()) assets.failed++; });
    page.on('response', response => { if (!response.request().isNavigationRequest() && response.status() >= 400) assets.httpErrors++; });
    if (remote) page.on('response', response => {
      if (edge || !isOwnOrigin(response.url(), config.sides[side].origin)) return;
      let main = false;
      try { main = response.request().isNavigationRequest() && response.frame().parentFrame() === null; } catch { /* A response without a frame is not the page. */ }
      edge = edgeStop({ status: response.status(), headers: response.headers(), main });
    });
    page.setDefaultTimeout(config.screenshot.timeoutMs);
    page.setDefaultNavigationTimeout(config.screenshot.timeoutMs);
    await context.route('**/*', async route => {
      const request = route.request();
      // R3.6: after an edge stop the capture sends no further request.
      if (edge) { await route.abort('blockedbyclient'); return; }
      if ((recipe.reveal?.length || recipe.lazyImages) && phase !== 'navigation' && phase !== 'behavior'
        && request.isNavigationRequest()) {
        // A popup can request its first URL before Playwright creates its frame.
        let topLevel = true;
        try { topLevel = request.frame().parentFrame() === null; } catch { /* Abort a navigation without a frame. */ }
        if (topLevel) {
          unexpectedNavigation = true;
          await route.abort('blockedbyclient');
          return;
        }
      }
      let topLevel = true;
      try { topLevel = !request.isNavigationRequest() ? false : request.frame().parentFrame() === null; } catch { /* A popup requests its first URL before its frame exists. Fail closed. */ }
      const decision = decideRequest(droppedLog, { url: request.url(), method: request.method(), topLevel, navigation: request.isNavigationRequest(), origin: config.sides[side].origin, remote, challenge: config.sides[side].challenge, resourceType: request.resourceType(), allowOrigins: config.sides[side].allowOrigins, thirdParty: config.sides[side].thirdParty });
      if (decision !== 'allow') {
        if (decision === 'block') {
          blocked = true;
          firstBlocked ??= describeBlockedRequest({ url: request.url(), method: request.method(), resourceType: request.resourceType(), topLevel, navigation: request.isNavigationRequest() });
        }
        await route.abort('blockedbyclient');
      } else {
        // Fetch one response without following redirects. Check Location before
        // the browser can issue a request to its destination.
        try {
          // R3.9: a local context ignores certificate errors. A request to an allowed origin goes through
          // a context that verifies them, so a bad certificate of a third party fails the request.
          const viaVerifier = verifier && isAllowedOriginRequest({ url: request.url(), resourceType: request.resourceType(), allowOrigins: config.sides[side].allowOrigins });
          const response = viaVerifier
            ? await verifier.request.fetch(request.url(), { method: request.method(), headers: request.headers(), maxRedirects: 0, timeout: config.screenshot.timeoutMs })
            : await route.fetch({ maxRedirects: 0, timeout: config.screenshot.timeoutMs });
          const location = response.headers().location;
          // R3.5: a redirect of an allowed write could repeat it on another path, so it fails the capture.
          const write = !['GET', 'HEAD'].includes(request.method());
          // R3.9: a subresource may also redirect to an allowed origin, for its own resource type.
          // A redirect from an allowed origin may lead only to an allowed origin.
          const permitted = href => redirectPermitted({ from: request.url(), to: href, ownTarget: allowedUrl(href), navigation: request.isNavigationRequest(), resourceType: request.resourceType(), allowOrigins: config.sides[side].allowOrigins });
          if (response.status() >= 300 && response.status() < 400 && (write || (location
            && !permitted(new URL(location, request.url()).href)))) {
            blocked = true;
            let target = request.url();
            try { if (location) target = new URL(location, request.url()).href; } catch { /* Keep the request URL. */ }
            firstBlocked ??= describeBlockedRequest({ url: target, method: request.method(), resourceType: request.resourceType(), topLevel, navigation: request.isNavigationRequest(), redirect: true });
            await route.abort('blockedbyclient');
          } else {
            // R3.9: an HTTP error answer of an allowed origin fails the capture, so a missing font does not pass in silence.
            const httpFailure = allowedOriginStatusFailure({ url: request.url(), method: request.method(), resourceType: request.resourceType(), allowOrigins: config.sides[side].allowOrigins, status: response.status() });
            if (httpFailure) { blocked = true; firstBlocked ??= httpFailure; await route.abort('blockedbyclient'); } else await route.fulfill({ response });
          }
        } catch (error) {
          // R3.9: any failed fetch of an allowed origin fails the capture, so no page renders in silence without its font.
          const failed = allowedOriginFailure({ url: request.url(), method: request.method(), resourceType: request.resourceType(), allowOrigins: config.sides[side].allowOrigins, error });
          if (failed) { blocked = true; firstBlocked ??= failed; }
          // R5.14: a failed fetch of the page itself reaches Chromium as a named network error, so the retry check can tell a reset from other faults.
          await route.abort(request.isNavigationRequest() ? navigationAbortCode(error) : 'failed').catch(() => {});
        }
      }
    });
    const url = new URL(targetPath(target, side), config.sides[side].origin);
    if (!allowedUrl(url.href)) throw new Error('Nonlocal navigation');
    const response = await page.goto(url.href, { waitUntil: 'load' });
    if (!response) throw new Error('No HTTP navigation response');
    statusCode = response.status();
    finalPath = new URL(response.url()).pathname;
    if (remote) edge ??= edgeStop({ status: statusCode, headers: response.headers(), main: true });
    if (edge) throw new Error('Remote edge stop');
    artifacts = await storeResponse({ response, requested: config.artifacts, runDir, targetId: target.id, viewportId: viewport.id, provenance, assets, active: () => !expired, artifacts });
    if (!config.artifacts.includes('screenshot') && !config.artifacts.includes('content') && !config.artifacts.includes('behavior') && !packRun?.ids.length) {
      if (edge || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Nonlocal navigation');
      return { ...identity, state: 'captured', statusCode, finalPath, ...stored(), artifacts, ...droppedFields(droppedLog) };
    }
    phase = 'settlement';
    await settlePage({ page, recipe, active: () => !expired && !edge && !blocked && !unexpectedNavigation, progress: settleProgress });
    if (edge || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Nonlocal navigation');
    if (config.artifacts.includes('content')) {
      phase = 'content';
      const index = { kind: 'content', ...provenance.content };
      let contentFile;
      let bodyFile;
      try {
        if (target.selector) throw new Error('Component content scope is not supported.');
        const snapshot = await extractContentSnapshot(page);
        const body = await page.evaluate(() => {
          const html = document.documentElement.outerHTML;
          if (html.length > 2 * 1024 * 1024) throw new Error('DOM body exceeds its limit.');
          return html;
        });
        const bodyBytes = Buffer.from(body);
        if (bodyBytes.length > 2 * 1024 * 1024) throw new Error('DOM body exceeds its limit.');
        const bytes = Buffer.from(JSON.stringify(snapshot));
        if (bytes.length > 2 * 1024 * 1024 || expired || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Content capture is unavailable.');
        const path = `content/${target.id}/${viewport.id}.json.gz`;
        contentFile = join(runDir, path);
        const bodyPath = `content/${target.id}/${viewport.id}.body.html.gz`;
        bodyFile = join(runDir, bodyPath);
        await mkdir(dirname(join(runDir, path)), { recursive: true });
        if (expired || blocked || unexpectedNavigation) throw new Error('Content capture is unavailable.');
        const compressed = gzipSync(bytes);
        await writeFile(contentFile, compressed, { mode: 0o600 });
        await writeFile(bodyFile, gzipSync(bodyBytes), { mode: 0o600 });
        if (expired || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Content capture is unavailable.');
        artifacts.content = { ...index, state: 'captured', path, bodyPath, bodyBytes: bodyBytes.length, bytes: compressed.length }; 
      } catch {
        if (contentFile) await unlink(contentFile).catch(() => {});
        if (bodyFile) await unlink(bodyFile).catch(() => {});
        artifacts.content = { ...index, state: 'failed', error: { code: 'CONTENT_CAPTURE_FAILED', message: target.selector ? 'Component content scope is not supported. Select a page target.' : 'Content snapshot is unavailable or exceeds its limit.' } };
      }
    }
    // R13.51: the selected page packs run on this page. With a screenshot they run after it, so they cannot change its pixels.
    const runPackStep = async () => {
      if (!packRun?.ids.length) return;
      phase = 'packs';
      Object.assign(artifacts, await runPagePacks({ page, ids: packRun.ids, runDir, targetId: target.id, viewportId: viewport.id,
        timeoutMs: config.screenshot.timeoutMs, settingsHash: packRun.settingsHash, browserVersion: packRun.browserVersion }));
      if (expired || edge || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Nonlocal navigation');
    };
    const captureBehavior = async () => {
      if (!config.artifacts.includes('behavior')) return;
      phase = 'behavior';
      const relativeDir = `behavior/${target.id}/${viewport.id}`;
      try {
        const result = await runBehavior({ page, ...behaviorSource, projectName: config.behavior.projects[viewport.id] ?? viewport.id,
          emulate: { reducedMotion: config.behavior.emulate.reducedMotion ?? (recipe.disableMotion ? 'reduce' : 'no-preference'), ...config.behavior.emulate },
          artifactDir: join(runDir, relativeDir), relativeDir, timeoutMs: config.behavior.timeoutMs, maxInstances: config.behavior.maxInstances, trace: config.behavior.trace });
        const bytes = Buffer.byteLength(JSON.stringify(result));
        if (bytes > 2 * 1024 * 1024) throw new Error('Behavior result exceeds its limit.');
        artifacts.behavior = { kind: 'behavior', tool: result.tool, version: result.version, settingsHash: result.settingsHash,
          browserVersion: provenance.behavior.browserVersion, state: result.state === 'complete' && !blocked ? 'captured' : 'failed', path: `${relativeDir}/results.json`, bytes,
          ...(result.state === 'complete' && !blocked ? {} : { error: { code: 'BEHAVIOR_INCOMPLETE', message: blocked ? 'A behavior request leaves the local environment or submits data.' : 'Behavior steps are failed, skipped, or incompatible.' } }) };
      } catch { artifacts.behavior = { kind: 'behavior', ...provenance.behavior, state: 'failed', error: { code: 'BEHAVIOR_CAPTURE_FAILED', message: 'Behavior evidence is unavailable or exceeds its limit.' } }; }
    };
    if (!config.artifacts.includes('screenshot')) {
      if (edge || blocked || expired || !allowedUrl(page.url())) throw new Error('Capture is unavailable.');
      await runPackStep();
      await captureBehavior();
      if (edge) throw new Error('Remote edge stop');
      return { ...identity, state: 'captured', statusCode, finalPath, ...stored(), artifacts, ...droppedFields(droppedLog) };
    }
    phase = 'screenshot';
    // R5.11: a target without the lazy-image sweep may hold images that never loaded. Read the count; it is no hash input.
    // A selector target counts only the images inside the selected elements.
    const warnings = captureWarnings({ lazyImages: recipe.lazyImages, unloaded: await countUnloadedLazyImages(page, target.selector) });
    let locator;
    let size;
    if (target.selector && !Array.isArray(target.selector) && target.box !== 'content') {
      locator = page.locator(target.selector).first();
      await locator.waitFor({ state: 'visible' });
      size = await locator.boundingBox();
      if (!size) throw new Error('Selector has no visible area');
    } else if (!target.selector) {
      size = config.screenshot.fullPage ? await page.evaluate(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, innerWidth),
        height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight),
      })) : { width: viewport.width, height: viewport.height };
    }
    if (size) assertImageBounds(size.width, size.height, viewport.deviceScaleFactor);
    await mkdir(dirname(file), { recursive: true });
    const options = { path: file, type: 'png', timeout: config.screenshot.timeoutMs,
      animations: recipe.disableMotion ? 'disabled' : 'allow', mask: recipe.masks.map(selector => page.locator(selector)) };
    const bytes = target.selector && !locator
      ? (await captureScopedScreenshot({ page, selector: target.selector, box: target.box ?? 'border', options })).bytes
      : locator ? await locator.screenshot(options) : await page.screenshot({ ...options, fullPage: config.screenshot.fullPage });
    // Verify actual PNG dimensions as well as the pre-capture estimate.
    if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Invalid screenshot PNG');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assertImageBounds(width, height);
    if (edge || blocked || unexpectedNavigation || !allowedUrl(page.url())) throw new Error('Nonlocal navigation');
    const final = new URL(page.url());
    await runPackStep();
    await captureBehavior();
    // R3.6: a behavior step can also meet the edge.
    if (edge) throw new Error('Remote edge stop');
    return { ...identity, state: 'captured', path: relativePath, statusCode: response.status(), finalPath: final.pathname,
      width, height, deviceScaleFactor: viewport.deviceScaleFactor, ...stored(), artifacts, ...droppedFields(droppedLog), ...warningFields(warnings) };
    })()]);
  } catch (caught) {
    // R5.15: the capture deadline and the page timeout are one value, so the deadline usually ends a hidden afterSweep wait.
    // The failure still names the selector, and it is not transient.
    const error = caught?.code === DEADLINE_CODE && phase === 'settlement' && settleProgress.afterSweep !== undefined ? afterSweepError(settleProgress.afterSweep) : caught;
    if (context) await context.close().catch(() => {});
    if (verifier) await verifier.close().catch(() => {});
    await unlink(file).catch(() => {});
    // R5.14: the verdict on the real error, before the message is generalized. The mark stays out of run.json.
    const transient = isTransientFailure({ error, edge, blocked, unexpectedNavigation, phase, statusCode });
    return markTransient({ ...identity, state: 'failed', artifacts, statusCode, finalPath, ...droppedFields(droppedLog), error: edge ? { code: 'REMOTE_EDGE_STOP', message: `The remote edge challenges or limits the capture (${edge}). The run stops.` } : { code: unexpectedNavigation ? 'SETTLEMENT_NAVIGATION_REQUIRED' : blocked ? 'LOCAL_NAVIGATION_REQUIRED' : `CAPTURE_${phase.toUpperCase()}_FAILED`,
      message: unexpectedNavigation ? 'A settlement action requests another page. Capture keeps one navigation.' : blocked ? blockedRequestMessage(firstBlocked) : ['PIN_NO_MATCH', 'AFTER_SWEEP_NOT_VISIBLE'].includes(error?.code) ? error.message : `The ${phase} step fails. Check the local page and capture recipe.` } }, transient);
  } finally { clearTimeout(timer); if (context) await context.close().catch(() => {}); if (verifier) await verifier.close().catch(() => {}); }
}

// R13.3: one GET to the side origin for the component list. Same certificate policy as the capture contexts.
async function readStyleguideTargets(tool, config, side) {
  const source = config.targetSource;
  if (source.side !== side) throw new Error(`targetSource reads the styleguide of side ${source.side}. Capture that side.`);
  const origin = config.sides[side].origin;
  const context = await tool.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const { targets, noFixture } = await readComponents({ origin, mount: source.mount, include: source.include, variants: source.variants === true, pages: source.pages === true, get: async url => {
      const response = await context.get(url, { headers: { accept: 'application/json' }, timeout: 30000, maxRedirects: 0 });
      return { status: response.status(), body: (await response.body()).toString('utf8') };
    } });
    // The stored settings read as a plain target list, so every reader of a run keeps working.
    // The source and what it found go in the run manifest, next to the settings.
    const { targetSource, ...rest } = config;
    return { config: { ...rest, targets }, found: { ...source, resolved: targets.length, ...(noFixture.length ? { noFixture } : {}) } };
  } finally { await context.dispose().catch(() => {}); }
}

export async function capture({ configPath, side, label = '', runsRoot, artifacts: requested, targets: selectedTargets, viewports: selectedViewports, packs: runPacks = false, retries: retryInput, keepExisting = false, baseDir }, dependencies = {}) {
  // R5.14: the retry bound is checked before anything starts.
  const retries = parseRetries(retryInput);
  const loaded = await loadConfig(configPath, { baseDir });
  let config = requested ? normalizeConfig({ ...loaded.config, artifacts: requested }) : loaded.config;
  if (!Object.hasOwn(config.sides, side)) throw new Error(`Unknown side: ${side}`);
  if (config.sides[side].kind === 'design') throw new Error(`Side ${side} is a design side. Use import, not capture.`);
  // R5.13: keep-existing needs a remote side. The command fails before any run directory or browser exists.
  if (keepExisting && config.sides[side].remote !== true) throw new Error('--keep-existing needs a side with remote: true. A local side captures fresh every time.');
  // R13.51: --packs needs a packs key. Without the flag nothing here runs (R5.1).
  const packPlan = runPacks ? planPackRun(config.packs, { remote: config.sides[side].remote === true }) : null;
  // R4.5: the selection is checked against the full lists before any run directory or browser exists.
  // With targetSource the target list is unknown until the catalogue is read, so the check runs after that read.
  const fromCatalogue = Boolean(config.targetSource);
  let selection = fromCatalogue ? null : recordSelection(config, { targets: selectedTargets, viewports: selectedViewports });
  if (typeof label !== 'string' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Run label must be bounded text');
  const behaviorSource = config.artifacts.includes('behavior') ? await loadBehaviorSource({ projectRoot: loaded.configDir, directory: config.behavior.source, lockfile: config.behavior.lockfile, enabled: config.behavior.enabled }) : null;
  // Verify DDEV before Playwright loads, so a stopped project starts no browser.
  if (new URL(config.sides[side].origin).hostname.endsWith('.ddev.site')) {
    const cwd = await projectRoot(loaded.configDir);
    let description;
    try {
      const { stdout } = await execute('ddev', ['describe', '--json-output'], { cwd, timeout: 30000 });
      description = JSON.parse(stdout);
    } catch { throw new Error('Cannot verify the DDEV project for the configured origin'); }
    if (!ddevMatchesOrigin(description, config.sides[side].origin)) throw new Error('The nearest DDEV checkout does not serve the configured origin');
    // Stop before the first page when DDEV is stopped. This sits outside the describe try/catch.
    const stopped = ddevStatusProblem(description);
    if (stopped) throw new Error(stopped);
    try { await execute('ddev', ['mutagen', 'sync'], { cwd, timeout: 60000 }); }
    catch { throw new Error('ddev mutagen sync fails. Fix DDEV synchronization before capture.'); }
  }
  const tool = await (dependencies.playwright ?? playwright)();
  // The catalogue is read before any run directory exists, so a bad catalogue leaves no partial run.
  let found;
  if (config.targetSource) ({ config, found } = await readStyleguideTargets(tool, config, side));
  if (fromCatalogue) selection = recordSelection(config, { targets: selectedTargets, viewports: selectedViewports });
  const at = new Date();
  const id = createRunId(at, process.pid, await gitSha(loaded.configDir));
  const root = runsRoot ? resolve(loaded.configDir, runsRoot) : loaded.runsRoot;
  const runDir = join(root, id);
  await mkdir(root, { recursive: true });
  await ensureDefaultRunsIgnore(loaded.configDir, root);
  await mkdir(runDir);
  const manifestPath = join(runDir, 'run.json');
  const effectiveSettings = { ...captureSettings(config, side), browser: BROWSER_SETTINGS, ...(behaviorSource ? { behavior: { ...config.behavior, fingerprint: behaviorSource.fingerprint } } : {}) };
  const hash = settingsHash(effectiveSettings);
  const run = { schemaVersion: 2, id, side, label, at: at.toISOString(), state: 'partial', settings: config, ...(found ? { targetSource: found } : {}),
    captureSettings: effectiveSettings, settingsHash: hash, ...(selection ? { selection } : {}), tools: [{ name: 'playwright', version: tool.version, settingsHash: hash }], captures: [] };
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
    const provenance = Object.fromEntries(config.artifacts.filter(kind => kind !== 'screenshot').map(kind => [kind, {
      tool: kind === 'behavior' ? 'test-kit-behavior' : 'playwright', version: kind === 'behavior' ? BEHAVIOR_VERSION : tool.version, browserVersion: browser.version(),
      settingsHash: settingsHash({ ...(kind === 'content' ? contentSettings(config, side) : responseSettings(config, kind)), browser: BROWSER_SETTINGS }),
    }]));
    for (const [artifact, index] of Object.entries(provenance)) run.tools.push({ name: index.tool, version: index.version, settingsHash: index.settingsHash, artifact });
    // The pack selection is not a capture setting. It stays out of the settings hash and out of the comparable tools (R13.44).
    const packRun = packPlan?.page.length ? { ids: packPlan.page, browserVersion: browser.version(),
      settingsHash: settingsHash({ pack: 'a11y', options: {}, browser: BROWSER_SETTINGS }) } : null;
    if (packPlan) run.packs = { selected: packPlan.selected, skipped: packPlan.skipped };
    await writeManifest(manifestPath, run);
    // R5.13: with --keep-existing, a cell may come from an earlier run of the store. The decision comes after the configuration is checked.
    const keepFinder = keepExisting ? createKeepFinder({ root, excludeId: id,
      current: { side, declaration: config.sides[side], settingsHash: hash, tools: run.tools },
      describe: (target) => ({ requested: config.artifacts, provenance: targetProvenance(config, side, target, provenance),
        recipe: captureRecipe(config, side, target), settleHash: settingsHash(settleRecipe(config, side, target)) }) }) : null;
    let stopped = false;
    for (const target of config.targets) for (const viewport of config.viewports) {
      if (!cellSelected(selection, target.id, viewport.id)) continue;
      // R3.6: after an edge stop, no further request goes to the remote side.
      if (stopped) {
        run.captures.push({ targetId: target.id, viewportId: viewport.id, settleHash: settingsHash(settleRecipe(config, side, target)), state: 'failed', artifacts: {},
          error: { code: 'RUN_STOPPED', message: 'An earlier capture met a remote edge stop. This capture did not run.' } });
        continue;
      }
      const kept = keepFinder ? await keepFinder({ target, viewport, runDir }) : null;
      if (kept) { run.captures.push(kept); await writeManifest(manifestPath, run); continue; }
      // R5.14: with --retries 0 (the default) this is one plain attempt.
      run.captures.push(await captureWithRetries(() => captureOne(browser, config, side, target, viewport, runDir, provenance, behaviorSource, packRun),
        { retries, sleep: dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), addWarning: withWarning }));
      stopped = run.captures.at(-1).error?.code === 'REMOTE_EDGE_STOP';
      const behaviorIndex = run.captures.at(-1).artifacts?.behavior;
      if (behaviorIndex?.path && !run.tools.some(item => item.settingsHash === behaviorIndex.settingsHash)) run.tools.push({ name: behaviorIndex.tool, version: behaviorIndex.version, settingsHash: behaviorIndex.settingsHash, artifact: 'behavior' });
      for (const [kind, index] of Object.entries(run.captures.at(-1).artifacts ?? {})) {
        if (packRun?.ids.includes(kind) && index.path && index.version !== 'unknown' && !run.tools.some(item => item.artifact === kind)) run.tools.push({ name: index.tool, version: index.version, settingsHash: index.settingsHash, artifact: kind });
      }
      await writeManifest(manifestPath, run);
    }
    // With a selection, `complete` means every selected cell is captured. `run.selection` tells the reader (R4.5).
    if (run.captures.every(result => result.state === 'captured' && config.artifacts.filter(kind => kind !== 'screenshot').every(kind => result.artifacts?.[kind]?.state === 'captured')
      && (packRun?.ids ?? []).every(kind => result.artifacts?.[kind]?.state === 'captured'))) run.state = 'complete';
    await writeManifest(manifestPath, run);
  } catch (error) {
    if (error.code === 'PLAYWRIGHT_VERSION_UNSUPPORTED') throw error;
    throw new Error(`Capture stops before completion. Evidence remains in ${manifestPath}. Check Chromium installation and local browser resources.`);
  } finally { if (browser) await browser.close(); }
  return { run, runDir, manifestPath };
}
