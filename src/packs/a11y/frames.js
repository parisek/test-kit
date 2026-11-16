// Pure. No DOM, no file system, no Playwright import (R4.4).
// It decides which frames of a page the runner may give axe to (R13.51, owner decision on #316, 2026-11-06).
// A frame is reachable when it has the origin of the top page, or when it is `about:blank` or `about:srcdoc` with a reachable parent.
// A frame of another origin is never reachable. A page with an opaque origin (`setContent`, `data:`) reaches no frame.
// This is only a pre-filter on a URL snapshot. The runner reads the origin again inside an isolated world of the frame, in the same step as the injection.
// `topUrl` may be an origin text. An opaque origin ('null') reaches no frame.
// Chosen safety bound, not a measured number.
export const MAX_FRAMES = 50;
const INHERITING = new Set(['about:blank', 'about:srcdoc']);

export function originOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin; // an opaque origin (data:, sandbox) never equals another
  } catch { return null; }
}

// `frames` lists the child frames in document order, parents before children: { url, parent, detached }.
// `parent` is the index in `frames` of the parent frame, or -1 for a child of the top page.
// Returns { reachable: boolean[], injected, unreachable }. A frame beyond MAX_FRAMES counts as unreachable.
export function classifyFrames(topUrl, frames) {
  if (!Array.isArray(frames)) throw new Error('frames must be a list.');
  const topOrigin = originOf(topUrl);
  if (topOrigin === null) return { reachable: frames.map(() => false), injected: 0, unreachable: frames.length }; // an opaque top origin cannot be told from a sandboxed frame
  const reachable = [];
  for (let index = 0; index < frames.length; index += 1) {
    const { url, parent, detached } = frames[index] ?? {};
    let parentOk = parent === -1;
    if (Number.isInteger(parent) && parent >= 0 && parent < index) parentOk = reachable[parent];
    let ok = false;
    if (index < MAX_FRAMES && parentOk && detached !== true) {
      if (INHERITING.has(url)) ok = true; // inherits the origin of its parent, which is reachable
      else {
        const origin = originOf(url);
        ok = origin !== null && origin === topOrigin;
      }
    }
    reachable.push(ok);
  }
  const injected = reachable.filter(Boolean).length;
  return { reachable, injected, unreachable: frames.length - injected };
}

const MAX_TREE = 10000; // chosen safety bound for the walk of the browser frame tree

// Pure. Flattens the browser frame tree (CDP `Page.getFrameTree`) below the top frame into a list in document order, parents before children:
// { id, parent, url }, where `parent` is the index in the list, or -1 for a child of the top frame. It lists at most MAX_TREE frames.
// Returns { frames, dropped, ids }. `dropped` counts the frames beyond the bound, so the caller can count them as unreachable.
// `ids` holds the frame id of every frame in the tree, listed or dropped, up to MAX_IDS; it is null when the tree holds more.
const MAX_IDS = 100000;
export function flattenFrameTree(tree) {
  const frames = [];
  let dropped = 0;
  let ids = new Set();
  let noId = 0;
  const stack = [];
  const push = (node, parent) => { for (const child of (Array.isArray(node?.childFrames) ? node.childFrames : []).slice().reverse()) stack.push({ node: child, parent }); };
  push(tree, -1);
  while (stack.length) {
    const { node, parent } = stack.pop();
    if (ids) { if (typeof node?.frame?.id === 'string') ids.add(node.frame.id); else noId += 1; if (ids.size + noId > MAX_IDS) ids = null; }
    if (frames.length >= MAX_TREE) { dropped += 1; push(node, -1); continue; } // counted, not listed
    const id = node?.frame?.id;
    const at = frames.length;
    frames.push({ id: typeof id === 'string' ? id : null, parent, url: typeof node?.frame?.url === 'string' ? node.frame.url : '' });
    push(node, at);
  }
  return { frames, dropped, ids: ids ? { set: ids, noId } : null };
}

// Pure. The frames of the second tree read that the first read did not hold, counted by frame id, so a frame added while another
// one went away still counts. Frames with no id count only by their growth between the reads (#347), so one held by the first read is not new.
// The comparison uses the ids of the whole tree, listed and dropped, so a frame pushed past the bound is not counted twice.
// When a tree is too large for its ids, the count falls back to the growth of the total.
export function addedFrames(before, after) {
  if (before.ids && after.ids) {
    let added = Math.max(0, after.ids.noId - before.ids.noId);
    for (const id of after.ids.set) if (!before.ids.set.has(id)) added += 1;
    return added;
  }
  return Math.max(0, after.frames.length + after.dropped - before.frames.length - before.dropped);
}

// Pure. True when a frame error means that the frame is gone or refused the gate: the origin gate, a lost or destroyed world (a navigation),
// a detached frame. The runner counts such a frame as unreachable. Any other error counts as failed.
// The texts are the exact CDP and Playwright messages (#347), so an axe error that only contains "not found" or "detached" counts as failed.
// A message must start with one of them. Only the prefixes that Playwright and CDP add may come first: an API name ("cdpSession.send: "),
// "Protocol error (Method): ", "Internal server error, " and "Error: ". So an axe error that quotes such a text later counts as failed.
const LOST_FRAME = /^(?:[a-z]\w*\.[a-z]\w*: )?(?:Protocol error \([\w.]+\): )?(?:Internal server error, )?(?:Error: )?(?:TEST_KIT_FRAME_ORIGIN\b|Cannot find context with specified id|Execution context was destroyed|No frame for given id found|Frame with the given id was not found|Target closed|Target page, context or browser has been closed|Inspected target navigated or closed|[Ss]ession closed|Session already detached|Frame (?:was|has been) detached)/;
export const isLostFrameError = message => LOST_FRAME.test(String(message));
