// Pure. Turns the stored artifact and the context into one frozen JSON-like snapshot (R7.1, R4.4).
// Stored artifacts are JSON (R9.2, R9.4), so the input contract is JSON-like data:
// primitives, arrays and plain objects. Anything else is rejected with its type and path.
export const MAX_DEPTH = 256; // a chosen safety bound, not a measured number

const shown = path => (path.length > 80 ? `...${path.slice(-77)}` : path); // keeps a message short
const typeName = value => {
  try { return Object.prototype.toString.call(value).slice(8, -1); } catch { return 'object'; }
};

const ON_PATH = -1;

// Checks one object and lists its children. It throws an Error that names the path and the type.
function children(node, path) {
  const proto = Object.getPrototypeOf(node);
  const isArray = Array.isArray(node);
  if (!(isArray ? proto === Array.prototype : proto === Object.prototype || proto === null)) throw new Error(`${shown(path) || 'input'} is a ${typeName(node)}, which is not JSON-like data.`);
  const keys = Reflect.ownKeys(node);
  if (isArray) {
    const length = node.length;
    if (keys.length !== length + 1) throw new Error(`${shown(path)} is a sparse array or has extra properties.`);
    for (let index = 0; index < length; index += 1) if (!Object.hasOwn(node, index)) throw new Error(`${shown(path)}[${index}] is a hole in an array.`);
  }
  const out = [];
  for (const key of keys) {
    if (isArray && key === 'length') continue;
    const where = isArray ? `${path}[${String(key)}]` : path === '' ? String(key) : `${path}.${String(key)}`;
    if (typeof key === 'symbol') throw new Error(`${shown(where)} is a symbol key, which is not JSON-like data.`);
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error(`${shown(where)} is an accessor or hidden property, which is not JSON-like data.`);
    out.push({ child: descriptor.value, where });
  }
  return out;
}

// Iterative post-order walk. Each object gets a height (1 + the tallest child), computed once, so a
// node that many paths reach is measured once and the walk is linear in nodes and edges. A node that is
// reached again while it is still on the path is a cycle. The wrapper { value, context } is level 0.
function inspect(root) {
  const heights = new WeakMap(); // node -> height, or ON_PATH while the node is open
  const frames = [];
  let rootHeight = 0;
  const enter = (node, path) => {
    const type = typeof node;
    if (node === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'undefined') return 0;
    if (type !== 'object') throw new Error(`${shown(path) || 'input'} is a ${type}, which is not JSON-like data.`);
    if (heights.has(node)) {
      const known = heights.get(node);
      if (known === ON_PATH) throw new Error(`${shown(path)} is a cycle, which is not JSON-like data.`);
      return known;
    }
    heights.set(node, ON_PATH);
    frames.push({ node, path, list: children(node, path), index: 0, tallest: 0 });
    return null;
  };
  const first = enter(root, '');
  if (first !== null) return;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index < frame.list.length) {
      const { child, where } = frame.list[frame.index];
      frame.index += 1;
      const height = enter(child, where);
      if (height !== null) frame.tallest = Math.max(frame.tallest, height);
      continue;
    }
    frames.pop();
    const height = 1 + frame.tallest;
    heights.set(frame.node, height);
    if (frames.length > 0) {
      const parent = frames[frames.length - 1];
      parent.tallest = Math.max(parent.tallest, height);
      if (height > MAX_DEPTH) throw new Error(`${shown(frame.path)} is nested deeper than ${MAX_DEPTH} levels.`);
    } else rootHeight = height;
  }
  return rootHeight;
}

function freeze(root) {
  const seen = new WeakSet();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    for (const key of Reflect.ownKeys(node)) stack.push(node[key]);
  }
  return root;
}

// One structuredClone of both parts keeps shared references: value.ref === context.ref stays true.
// The input is checked before the clone (clear messages, no deep recursion) and the clone is checked again,
// so a getter that changes between reads cannot bring a bad type into the snapshot.
export function snapshotInput(value, context) {
  inspect({ value, context });
  const copy = structuredClone({ value, context });
  inspect(copy);
  freeze(copy);
  return copy;
}

export { freeze as deepFreeze, inspect as inspectJsonLike };
