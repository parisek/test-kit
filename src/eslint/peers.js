// Impure only through the importer. Loads the optional peers of the ESLint entry point (R13.46).
// A missing required peer throws LINT_PEER_MISSING. A missing enhancement becomes a warning (R13.47).
// It imports no browser package: the lint entry point must work without Playwright, axe-core or Lighthouse.

export const REQUIRED = [
  { name: '@eslint/js', install: 'npm i -D eslint @eslint/js' },
  { name: 'eslint-plugin-import', install: 'npm i -D eslint-plugin-import' },
];

export class LintPeerError extends Error {
  constructor(peer, install) {
    super(`The ESLint entry point of test-kit needs the package "${peer}", and it is not installed. Install it: ${install}`);
    this.name = 'LintPeerError';
    this.code = 'LINT_PEER_MISSING';
    this.peer = peer;
  }
}

// True only when the module that failed to load is `name` itself. A missing transitive
// package, or an error inside the peer, must still surface as it is.
export function isMissing(error, name) {
  return Boolean(error)
    && error.code === 'ERR_MODULE_NOT_FOUND'
    && typeof error.message === 'string'
    && error.message.includes(`'${name}'`);
}

async function load(importer, name) {
  try {
    const mod = await importer(name);
    return mod.default ?? mod;
  } catch (error) {
    if (isMissing(error, name)) return null;
    throw error;
  }
}

export async function loadPeers(importer = (name) => import(name)) {
  const warnings = [];
  const loaded = {};
  for (const { name, install } of REQUIRED) {
    const value = await load(importer, name);
    if (!value) throw new LintPeerError(name, install);
    loaded[name] = value;
  }

  const globals = await load(importer, 'globals');
  if (!globals) {
    warnings.push(
      '[test-kit/eslint] "globals" is not installed. Browser files fall back to a short list of browser globals, '
      + 'so an unusual browser API may report as undefined. Test, script and config files get no Node globals. '
      + 'Install it: npm i -D globals',
    );
  }

  const tseslint = await load(importer, 'typescript-eslint');
  if (!tseslint) {
    warnings.push(
      '[test-kit/eslint] "typescript-eslint" is not installed. TypeScript files and script blocks with lang="ts" are not linted. '
      + 'Install it: npm i -D typescript-eslint typescript',
    );
  }

  // Vue support needs both packages. One without the other is useless.
  const vue = await load(importer, 'eslint-plugin-vue');
  const vueParser = await load(importer, 'vue-eslint-parser');
  if (!vue || !vueParser) {
    const names = [!vue && '"eslint-plugin-vue"', !vueParser && '"vue-eslint-parser"'].filter(Boolean);
    warnings.push(
      `[test-kit/eslint] ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} not installed. Vue single-file components are not linted. `
      + 'Install them: npm i -D eslint-plugin-vue vue-eslint-parser',
    );
  }

  return {
    js: loaded['@eslint/js'],
    importPlugin: loaded['eslint-plugin-import'],
    globals,
    tseslint,
    vue: vue && vueParser ? vue : null,
    vueParser: vue && vueParser ? vueParser : null,
    warnings,
  };
}
