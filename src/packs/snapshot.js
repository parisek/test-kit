// Pure. Turns the stored artifact and the context into one frozen JSON-like snapshot (R7.1, R4.4).
// Stored artifacts are JSON (R9.2, R9.4), so the input contract is JSON-like data:
// primitives, arrays and plain objects. Anything else is rejected with its type and path.
export const MAX_DEPTH = 256; // a chosen safety bound, not a measured number

const shown = path => (path.length > 80 ? `...${path.slice(-77)}` : path); // keeps a message short
const typeName = value => {
  try { return Object.prototype.toString.call(value).slice(8, -1); } catch { return 'object'; }
};

// Walks without recursion. It throws an Error that names the path and the type.
function inspect(root) {
  const seen = new WeakSet();
  const stack = [{ node: root, path: '', depth: 0 }];
  while (stack.length > 0) {
    const { node, path, depth } = stack.pop();
    const type = typeof node;
    if (node === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'undefined') continue;
    if (type !== 'object') throw new Error(`${shown(path) || 'input'} is a ${type}, which is not JSON-like data.`);
    if (seen.has(node)) continue;
    seen.add(node);
    if (depth > MAX_DEPTH) throw new Error(`${shown(path)} is nested deeper than ${MAX_DEPTH} levels.`);
    const proto = Object.getPrototypeOf(node);
    const isArray = Array.isArray(node);
    if (!(isArray ? proto === Array.prototype : proto === Object.prototype || proto === null)) throw new Error(`${shown(path) || 'input'} is a ${typeName(node)}, which is not JSON-like data.`);
    const keys = Reflect.ownKeys(node);
    if (isArray) {
      const length = node.length;
      if (keys.length !== length + 1) throw new Error(`${shown(path)} is a sparse array or has extra properties.`);
      for (let index = 0; index < length; index += 1) if (!Object.hasOwn(node, index)) throw new Error(`${shown(path)}[${index}] is a hole in an array.`);
    }
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      const where = isArray ? `${path}[${String(key)}]` : path === '' ? String(key) : `${path}.${String(key)}`;
      if (typeof key === 'symbol') throw new Error(`${shown(where)} is a symbol key, which is not JSON-like data.`);
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error(`${shown(where)} is an accessor or hidden property, which is not JSON-like data.`);
      stack.push({ node: descriptor.value, path: where, depth: depth + 1 });
    }
  }
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

export { freeze as deepFreeze };
