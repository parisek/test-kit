// Test helper. A module-resolution hook that makes the named packages unresolvable.
// A blocked specifier fails like a package that is not installed (ERR_MODULE_NOT_FOUND).
// `initialize` receives the list from `register.mjs`.
let blocked = [];

export function initialize(data) {
  blocked = data?.blocked ?? [];
}

export async function resolve(specifier, context, nextResolve) {
  if (blocked.includes(specifier)) {
    const error = new Error(`Cannot find package '${specifier}' imported from ${context.parentURL}`);
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return nextResolve(specifier, context);
}
