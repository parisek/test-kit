// Pure. No DOM, no file system, no Playwright import (R4.4).
// It decides which frames of a page the runner may give axe to (R13.51, owner decision on #316, 2026-11-06).
// A frame is reachable when it has the origin of the top page, or when it is `about:blank` or `about:srcdoc` with a reachable parent.
// A frame of another origin is never reachable. A page with an opaque origin (`setContent`, `data:`) reaches no frame.
// This is only a pre-filter on a URL snapshot. The runner checks the origin again inside the frame, in the same step as the injection. A detached frame is not reachable.
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

const MAX_DOM_NODES = 500000; // chosen safety bound for the walk of an untrusted DOM tree

// Pure. Reads the browser's own DOM tree (CDP `DOM.getDocument` with `pierce`) and returns a Map from the value of the mark attribute
// to the frame ID that the browser gives the iframe element. The runner marks each candidate frame element with its index, so the match is exact
// and a page cannot change it. An element that the page marked itself with the same attribute name is a different name, because the name is random.
// A tree beyond the bound throws, and the runner then treats every frame as unreachable.
export function frameIdsByMark(root, attr) {
  const ids = new Map();
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (++seen > MAX_DOM_NODES) throw new Error('The DOM tree is too large.');
    if (Array.isArray(node.attributes) && typeof node.frameId === 'string') {
      for (let at = 0; at + 1 < node.attributes.length; at += 2) if (node.attributes[at] === attr) ids.set(node.attributes[at + 1], node.frameId);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) stack.push(child);
    if (node.contentDocument) stack.push(node.contentDocument);
    for (const child of Array.isArray(node.shadowRoots) ? node.shadowRoots : []) stack.push(child);
  }
  return ids;
}
