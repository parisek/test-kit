// Entry point `@parisek/test-kit/packs/a11y`. Pure. It imports no browser and no axe-core (R4.4).
// The pack is opt-in. A project must select it (G3, R5.1, R13.42).
import { definePack } from '../define.js';
import { axeFindings } from './axe.js';

export const a11yAxeCheck = Object.freeze({
  id: 'a11y-axe',
  title: 'Accessibility (axe)',
  basis: 'absolute',
  applies: { artifacts: ['a11y'] },
  check: axeFindings,
});

export const a11yPack = definePack({ id: 'a11y', title: 'Accessibility (axe)', owner: 'parisek', checks: [a11yAxeCheck] });

export { reduceAxeResults, gapArtifact, axeFindings, IMPACT_SEVERITY, LIMITS } from './axe.js';
