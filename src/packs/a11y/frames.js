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
// { id, parent, url }, where `parent` is the index in the list, or -1 for a child of the top frame. It reads at most MAX_TREE frames.
export function flattenFrameTree(tree) {
  const frames = [];
  const stack = [];
  const push = (node, parent) => { for (const child of (Array.isArray(node?.childFrames) ? node.childFrames : []).slice().reverse()) stack.push({ node: child, parent }); };
  push(tree, -1);
  while (stack.length && frames.length < MAX_TREE) {
    const { node, parent } = stack.pop();
    const id = node?.frame?.id;
    const at = frames.length;
    frames.push({ id: typeof id === 'string' ? id : null, parent, url: typeof node?.frame?.url === 'string' ? node.frame.url : '' });
    push(node, at);
  }
  return frames;
}
