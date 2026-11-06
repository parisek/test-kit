// Thin runner. It injects axe-core into a Playwright page and returns a stored `a11y` artifact.
// axe-core is an optional peer dependency. This file is the only place that reads it.
// It never throws for a bad run or bad options. It returns a `missing` or `failed` artifact (R8.7).
//
// Limits:
// - Frames: axe runs in an isolated world (Chromium, CDP) of the top document and of each frame of the page origin and each about:blank / srcdoc frame below them,
//   at most 50 frames, with no axe frame messaging. It never runs in another origin (R13.51). A frame that it does not run in is counted in `frames.unreachable`. A frame lost during its run (it navigated) counts as unreachable. Frames added during the run are counted by one more read of the tree at the end.
//   The busy claim stays per page. The runner writes nothing to the page, apart from the busy flag. Without CDP axe runs in the main world of the top document only.
// - After a timeout, axe may still run on the page. Do not reuse that page. A second run on it returns `failed`.
// - With CDP (Chromium) axe runs in an isolated world, so page script cannot replace `window.axe` there. Without CDP the top document runs in the main world and a hostile page can fake a result.
//   In both cases a hostile page can still change the DOM that axe reads. Run it on pages you control.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { reduceAxeResults, mergeFrameResult, gapArtifact } from './axe.js';
import { classifyFrames, flattenFrameTree, isLostFrameError } from './frames.js';

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30000;
const BUSY = '__testKitAxeBusy';
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Axe runs in an isolated world of each frame (CDP `Page.createIsolatedWorld`), never in the main world of a frame. The isolated world shares
// the DOM with the page but not its JavaScript globals, so page script cannot redefine `self.origin` or `window.axe` there. Axe never
// messages frames (`iframes: false`), so a frame that is not run is never visited. The runner writes nothing to the page.
const WORLD = 'test-kit-axe';
const RUN_BODY = `(async tags => {
  if (typeof globalThis.axe?.run !== 'function') throw new Error('axe did not load.');
  for (const tag of tags ?? []) if (globalThis.axe.getRules([tag]).length === 0) throw new Error('No axe rule has the tag ' + tag + '.');
  return globalThis.axe.run(document, { iframes: false, ...(tags ? { runOnly: { type: 'tag', values: tags } } : {}) });
})`;
// One expression for one world. In a frame its first statement reads the origin of the world and throws unless it is the page origin.
// A navigation destroys the world, so a frame that moved after the check cannot run the code.
const worldCode = (gateOrigin, source, tags) => `${gateOrigin === null ? '' : `if (self.origin !== ${JSON.stringify(gateOrigin)}) throw new Error('TEST_KIT_FRAME_ORIGIN');\n`}${source}\n;${RUN_BODY}(${JSON.stringify(tags ?? null)})`;

async function createWorld(cdp, frameId) {
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId, worldName: WORLD });
  return executionContextId;
}
async function evaluateIn(cdp, contextId, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { contextId, expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(String(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'evaluation failed'));
  return result.value;
}
// The selector of the frame element in its parent document, computed in the isolated world of the parent. It writes nothing to the page.
async function frameSelector(cdp, frameId, parentContext) {
  const { backendNodeId } = await cdp.send('DOM.getFrameOwner', { frameId });
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId, executionContextId: parentContext });
  const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function () { const { axe } = globalThis; axe.setup(this.ownerDocument.documentElement); try { return axe.utils.getSelector(this); } finally { axe.teardown(); } }',
    returnByValue: true
  });
  if (exceptionDetails || typeof result.value !== 'string') throw new Error('The frame has no selector.');
  return result.value;
}

// Runs axe in the top document and once in each reachable frame (at most MAX_FRAMES), and merges the results (R13.51).
// A frame that a gate refuses counts as unreachable. A frame where axe or the merge breaks counts as failed. A frame below either is not run.
// Without a CDP session (a browser other than Chromium) axe runs in the main world of the top document and no frame is run.
async function runWorlds(page, source, tags, stopped) {
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); } catch { cdp = null; }
  if (cdp === null) {
    await page.evaluate(source);
    const top = await page.evaluate(`${RUN_BODY}(${JSON.stringify(tags ?? null)})`);
    return { merged: top, frames: { injected: 0, unreachable: page.frames().length - 1, failed: 0 } };
  }
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const topContext = await createWorld(cdp, frameTree.frame.id);
    const topOrigin = await evaluateIn(cdp, topContext, 'self.origin');
    let merged = await evaluateIn(cdp, topContext, worldCode(null, source, tags));
    const { frames: children, dropped } = flattenFrameTree(frameTree);
    // A URL pre-filter and the bound. The origin of each frame is then read in its own isolated world, just before axe runs there.
    const plan = classifyFrames(topOrigin, children.map(child => ({ url: child.url, parent: child.parent, detached: child.id === null })));
    const contexts = [];
    const chains = [];
    const ok = [];
    let failed = 0;
    for (let at = 0; at < children.length; at += 1) {
      let done = false;
      const parent = children[at].parent;
      if (!stopped() && plan.reachable[at] && (parent === -1 || ok[parent])) {
        try {
          const parentContext = parent === -1 ? topContext : contexts[parent];
          const selector = await frameSelector(cdp, children[at].id, parentContext);
          const context = await createWorld(cdp, children[at].id);
          const result = await evaluateIn(cdp, context, worldCode(topOrigin, source, tags));
          const chain = [...(parent === -1 ? [] : chains[parent]), selector];
          merged = mergeFrameResult(merged, chain, result);
          contexts[at] = context;
          chains[at] = chain;
          done = true;
        } catch (error) {
          // A gate that says no, or a frame that went away, is unreachable. Any other break is a failed frame and gets its own warning.
          if (!isLostFrameError(error?.message)) failed += 1;
        }
      }
      ok.push(done);
    }
    const injected = ok.filter(Boolean).length;
    // The list is one snapshot. One more read of the tree counts frames that were added during the run as unreachable. A removed frame is not subtracted.
    let added = 0;
    try {
      const again = flattenFrameTree((await cdp.send('Page.getFrameTree')).frameTree);
      added = Math.max(0, again.frames.length + again.dropped - children.length - dropped);
    } catch { added = 0; }
    return { merged, frames: { injected, unreachable: children.length + dropped + added - injected - failed, failed } };
  } finally {
    await cdp.detach().catch(() => {});
  }
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
        const { merged, frames } = await runWorlds(page, source, tags, () => timedOut);
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
