// Pure. The opt-in lint pack: two absolute checks over the stored `lint` artifact (R7.2, R8.10, R9.9, R9.11).
// A project selects the pack by name. Nothing runs by default (G3, R5.1).
import { definePack } from '../define.js';
import { checkLocation, copyFileTargets, TOOLS, MAX_ITEMS } from './normalize.js';

const TITLES = { eslint: 'ESLint rules', stylelint: 'Stylelint rules' };
const PROJECT = '@project';

// The `lint` artifact value is JSON data. It holds only normalized, relative data:
//   { fileTargets?: { "<relative file>": "<component id>" },
//     tools: { eslint?: { status, version?, items?, total?, diagnostic? }, stylelint?: { ... } } }
// `status` is `ok`, `missing` or `failed`. `items` is a list of { severity, rule, message, location }.
// Only the runner writes it. The check validates it again and fails closed (R8.7).

function copyItem(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('A stored lint item must be an object.');
  const { severity, rule, message, location, outside, ...rest } = raw; // one read of each field
  if (outside !== undefined && outside !== true) throw new Error('A stored lint item has a bad outside flag.');
  if (Object.keys(rest).length > 0) throw new Error('A stored lint item has an unknown key.');
  if (severity !== 'error' && severity !== 'warning') throw new Error('A stored lint item has a bad severity.');
  if (rule !== null && typeof rule !== 'string') throw new Error('A stored lint item has a bad rule.');
  if (typeof message !== 'string' || message.trim() === '') throw new Error('A stored lint item needs a message.');
  const place = checkLocation(location);
  // A file outside the root never maps to a component (R9.11). Only the flag decides, not the file name.
  return { severity, rule, message, location: place, outside: outside === true };
}

function lintCheck(tool) {
  return {
    id: `${tool}-rules`,
    title: TITLES[tool],
    basis: 'absolute',
    applies: { artifacts: ['lint'] },
    check(value) {
      const targets = copyFileTargets(value?.fileTargets); // a bad map throws, so the check is failed
      const targetOf = file => (Object.hasOwn(targets, file) ? targets[file] : PROJECT);
      const entry = value?.tools?.[tool];
      const open = message => [{ targetId: PROJECT, severity: 'info', message: String(message).slice(0, 900), evidence: { tool, state: 'incomplete' } }];
      if (entry === undefined || entry === null) return open(`${TITLES[tool]} did not run. The project did not select this tool.`);
      const { status, diagnostic, items: rawItems, total } = entry; // one read of each field
      if (status === 'missing') return open(diagnostic ?? `${tool} is not installed in the project.`);
      if (status !== 'ok') throw new Error(String(diagnostic ?? `${tool} did not finish.`).slice(0, 300));
      if (!Array.isArray(rawItems) || rawItems.length > MAX_ITEMS || !Number.isInteger(total) || total < rawItems.length) throw new Error(`The stored ${tool} report is malformed.`);
      const found = rawItems.map(copyItem).map(({ severity, rule, message, location, outside }) => ({
        targetId: outside ? PROJECT : targetOf(location.file), // R9.11: a file that maps to a component uses its id
        severity, message, location, evidence: { tool, rule },
      }));
      // A cut list never reads as complete (R8.7).
      if (total > found.length) found.push(...open(`The ${tool} report has ${total} problems. Only the first ${found.length} are listed.`).map(finding => ({ ...finding, evidence: { tool, state: 'incomplete', total } })));
      return found;
    },
  };
}

export const lintPack = definePack({
  id: 'lint',
  title: 'ESLint and Stylelint',
  owner: 'test-kit',
  checks: TOOLS.map(lintCheck),
});
