// Thin runner. It injects axe-core into a Playwright page and returns a stored `a11y` artifact.
// axe-core is an optional peer dependency. This file is the only place that reads it.
// It never throws for a bad run or bad options. It returns a `missing` or `failed` artifact (R8.7).
//
// Limits:
// - Frames: axe runs once in the top document and once in each frame of the page origin and each about:blank / srcdoc frame below them, at most 50 frames,
//   with no axe frame messaging. It never runs in another origin (R13.51). A frame that it does not run in is counted in `frames.unreachable`. The busy claim stays per page: the top document holds it.
// - After a timeout, axe may still run on the page. Do not reuse that page. A second run on it returns `failed`.
// - Axe runs inside the page. A hostile page can replace `window.axe` and fake a clean result. Run it on pages you control.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { reduceAxeResults, mergeFrameResult, gapArtifact } from './axe.js';
import { classifyFrames, frameIdsByMark, originOf } from './frames.js';

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30000;
const BUSY = '__testKitAxeBusy';
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// The code that runs axe in one document. `ctx` is { topOrigin?, tags, source? }. Axe never messages frames (`iframes: false`), so a frame
// that is not run is never visited. In a frame the first statement reads the origin of the frame itself, in the same evaluation that loads axe
// and runs it. A frame that navigated after the URL snapshot, or that has an opaque origin (a sandbox without `allow-same-origin`), throws.
const RUN_BODY = `(async tags => {
  if (typeof globalThis.axe?.run !== 'function') throw new Error('axe did not load in the page.');
  for (const tag of tags ?? []) if (globalThis.axe.getRules([tag]).length === 0) throw new Error('No axe rule has the tag ' + tag + '.');
  return globalThis.axe.run(document, { iframes: false, ...(tags ? { runOnly: { type: 'tag', values: tags } } : {}) });
})`;
const frameCode = (topOrigin, source, tags) => `if (self.origin !== ${JSON.stringify(topOrigin)}) throw new Error('TEST_KIT_FRAME_ORIGIN');\n${source}\n;${RUN_BODY}(${JSON.stringify(tags ?? null)})`;

// Runs axe once in each reachable frame (at most MAX_FRAMES) and merges the results into `raw`. Never in another origin (R13.51).
// A frame that a gate refuses counts as unreachable. A frame where axe or the merge breaks counts as failed. A frame below either is not run.
async function runFrames(page, source, tags, raw, stopped) {
  const children = page.frames().filter(frame => frame !== page.mainFrame());
  const index = new Map(children.map((frame, at) => [frame, at]));
  const parents = children.map(frame => (frame.parentFrame() === page.mainFrame() ? -1 : (index.get(frame.parentFrame()) ?? -2)));
  const urls = children.map(frame => frame.url());
  const topOrigin = originOf(page.url());
  const plan = classifyFrames(page.url(), children.map((frame, index) => ({ url: urls[index], parent: parents[index], detached: frame.isDetached() })));
  const ok = [];
  const chains = [];
  let failed = 0;
  let merged = raw;
  // The origin of each frame comes from the browser, not from the frame's own script, which can redefine `self.origin` (R13.51).
  // Each candidate frame element gets a mark with a random name for this run. One read of the browser DOM tree then gives the frame ID
  // of each element. The origin is read in an isolated world of the frame: a property that the page sets on its own `window` is not visible there.
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); } catch { cdp = null; } // no session: no frame is reachable
  const attr = `data-test-kit-axe-frame-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const marked = [];
  let frameIds = new Map();
  if (cdp !== null) {
    for (let at = 0; at < children.length; at += 1) {
      if (!plan.reachable[at]) continue;
      try {
        const element = await children[at].frameElement();
        await element.evaluate((node, [name, value]) => node.setAttribute(name, value), [attr, String(at)]);
        marked.push(element);
      } catch { /* a detached frame has no element */ }
    }
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      frameIds = frameIdsByMark(root, attr);
    } catch { frameIds = new Map(); }
    for (const element of marked) await element.evaluate((node, name) => node.removeAttribute(name), attr).catch(() => {});
  }
  const browserOrigin = async at => {
    const frameId = frameIds.get(String(at));
    if (cdp === null || frameId === undefined) return null;
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId, worldName: 'test-kit-origin-gate' });
    const { result } = await cdp.send('Runtime.evaluate', { contextId: executionContextId, expression: 'self.origin', returnByValue: true });
    return typeof result.value === 'string' ? result.value : null;
  };
  try {
    for (let at = 0; at < children.length; at += 1) {
      let done = false;
      if (!stopped() && plan.reachable[at] && (parents[at] === -1 || ok[parents[at]])) {
        try {
          if (children[at].url() !== urls[at]) throw new Error('TEST_KIT_FRAME_MOVED');
          if (await browserOrigin(at) !== topOrigin) throw new Error('TEST_KIT_FRAME_ORIGIN');
          // The selector of the frame element in its parent document. The parent already has axe.
          const element = await children[at].frameElement();
          const selector = await element.evaluate(node => { const { axe } = globalThis; axe.setup(node.ownerDocument.documentElement); try { return axe.utils.getSelector(node); } finally { axe.teardown(); } });
          const chain = [...(parents[at] === -1 ? [] : chains[parents[at]]), selector];
          const result = await children[at].evaluate(frameCode(topOrigin, source, tags));
          merged = mergeFrameResult(merged, chain, result);
          chains[at] = chain;
          done = true;
        } catch (error) {
          // A gate that says no, or a detached frame, is unreachable. Any other break is a failed frame and gets its own warning.
          if (!/TEST_KIT_FRAME_/.test(String(error?.message)) && !children[at].isDetached()) failed += 1;
        }
      }
      ok.push(done);
    }
  } finally {
    await cdp?.detach().catch(() => {});
  }
  const injected = ok.filter(Boolean).length;
  return { merged, frames: { injected, unreachable: children.length - injected - failed, failed } };
}

async function loadSource(axePath) {
  try {
    return await readFile(axePath ?? require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

// Reads each option once. Returns { tags, timeoutMs, axePath } or throws.
function readOptions(options) {
  if (options === undefined || options === null) options = {};
  if (!isPlain(options)) throw new Error('The options must be a plain object.');
  const { tags, timeoutMs = DEFAULT_TIMEOUT_MS, axePath } = options; // one read of each field
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('timeoutMs must be a finite number from 1 to 2147483647.');
  if (axePath !== undefined && (typeof axePath !== 'string' || axePath === '')) throw new Error('axePath must be a path text.');
  let copy;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > 50) throw new Error('tags must be a list of 1 to 50 texts.');
    copy = Array.from({ length: tags.length }, (_, index) => tags[index]); // one read of each element
    if (copy.some(tag => typeof tag !== 'string' || tag === '' || tag.length > 100)) throw new Error('tags must be a list of texts.');
  }
  return { tags: copy, timeoutMs, axePath };
}

// `page` is a Playwright page that is already on the URL to check.
// Options: `tags` (axe rule tags, for example ['wcag2a', 'wcag2aa']), `timeoutMs`, `axePath` (path to axe.min.js).
// Every step that touches the page runs inside the timer, so a busy page cannot hang the caller.
export async function runAxe(page, options) {
  let timer;
  let timedOut = false;
  try {
    const { tags, timeoutMs, axePath } = readOptions(options);
    const run = (async () => {
      const source = await loadSource(axePath);
      if (source === null) return gapArtifact('missing', 'axe-core is not installed.');
      // One atomic step claims the page. A second run, or a run after an unfinished one, stops here.
      const claimed = await page.evaluate(busy => { if (globalThis[busy]) return false; globalThis[busy] = true; return true; }, BUSY);
      if (!claimed) throw new Error('An axe run is active on this page, or an earlier one did not finish. Use a new page.');
      try {
        await page.evaluate(source);
        const top = await page.evaluate(`${RUN_BODY}(${JSON.stringify(tags ?? null)})`);
        const { merged, frames } = await runFrames(page, source, tags, top, () => timedOut);
        return reduceAxeResults(merged, frames);
      } finally {
        // Only the run that claimed the page releases it. After a timeout the page stays claimed.
        if (!timedOut) await page.evaluate(busy => { delete globalThis[busy]; }, BUSY).catch(() => {});
      }
    })();
    run.catch(() => {}); // a late failure after a timeout is not an unhandled rejection
    return await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`axe did not finish in ${timeoutMs} ms. Do not reuse this page.`)); }, timeoutMs); })]);
  } catch (error) {
    return gapArtifact('failed', error?.message ?? error);
  } finally {
    clearTimeout(timer);
  }
}
