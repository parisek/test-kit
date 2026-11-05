// Entry point `@parisek/test-kit/eslint` (R13.40, R13.46 to R13.49).
// The default export is a flat-config array. A project imports it and adds its own blocks after it:
//   import testKit from '@parisek/test-kit/eslint';
//   export default [...testKit, { languageOptions: { globals: { gsap: 'readonly' } } }];
// Importing this file loads the lint peers only. It loads no browser package.
import { buildConfig } from './config.js';
import { LintPeerError, loadPeers } from './peers.js';
import plugin from './rules/index.js';

const peers = await loadPeers();
for (const warning of peers.warnings) console.warn(warning);

export default buildConfig(peers);
export { plugin, LintPeerError };
