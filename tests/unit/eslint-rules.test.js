// Gate for the portadesign ESLint rule tests (R13.40, R13.50). They need eslint and typescript-eslint.
import { runWithPeers } from '../helpers/lint-peers.js';

await runWithPeers('portadesign ESLint rules', ['eslint', 'typescript-eslint'], () => import('../lint-cases/eslint-rules.mjs'));
