// Pure. The opt-in lint pack: two absolute checks over the stored `lint` artifact (R7.2, R8.10, R9.9, R9.11).
// A project selects the pack by name. Nothing runs by default (G3, R5.1).
import { definePack } from '../define.js';
import { normalizeEslint, normalizeStylelint, TOOLS } from './normalize.js';

const NORMALIZERS = { eslint: normalizeEslint, stylelint: normalizeStylelint };
const TITLES = { eslint: 'ESLint rules', stylelint: 'Stylelint rules' };

// The `lint` artifact value is JSON data:
//   { root, tools: { eslint?: { status, version?, output?, diagnostic? }, stylelint?: { ... } } }
// `status` is `ok`, `missing` or `failed`. Only the runner writes it.
function lintCheck(tool) {
  return {
    id: `${tool}-rules`,
    title: TITLES[tool],
    basis: 'absolute',
    applies: { artifacts: ['lint'] },
    check(value, context) {
      const root = typeof value?.root === 'string' ? value.root : undefined;
      const entry = value?.tools?.[tool];
      const targetId = typeof context?.targetId === 'string' && context.targetId !== '' ? context.targetId : '@project';
      if (entry === undefined || entry === null) {
        return [{ targetId, severity: 'info', message: `${TITLES[tool]} did not run. The project did not select this tool.`, evidence: { tool, state: 'incomplete' } }];
      }
      if (entry.status === 'missing') {
        return [{ targetId, severity: 'info', message: String(entry.diagnostic ?? `${tool} is not installed in the project.`).slice(0, 900), evidence: { tool, state: 'incomplete' } }];
      }
      if (entry.status !== 'ok') throw new Error(String(entry.diagnostic ?? `${tool} did not finish.`).slice(0, 300));
      // A malformed report throws here, so the check is `failed` and never `complete` (R8.7).
      return NORMALIZERS[tool](entry.output, { root }).map(item => ({ ...item, targetId }));
    },
  };
}

export const lintPack = definePack({
  id: 'lint',
  title: 'ESLint and Stylelint',
  owner: 'test-kit',
  checks: TOOLS.map(lintCheck),
});
