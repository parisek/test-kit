// Gate for the portadesign Stylelint rule tests (R13.40, R13.50). They need stylelint.
import { runWithPeers } from '../helpers/lint-peers.js';

await runWithPeers('portadesign Stylelint rules', ['stylelint'], () => import('../lint-cases/stylelint-rules.mjs'));
