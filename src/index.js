// Public API of the package. It grows with the plan in docs/specification.md (section 14).
export { run, COMMANDS } from './cli/run.js';
export { planLegacySelection } from './compat/selection.js';

export { collectContracts, validateContracts, loadProjectContracts, loadBehaviorSource, runBehavior, compareBehavior } from './behavior/index.js';

export { runPerformance, comparePerformance, evaluateBudgets, performanceSettings } from './perf/index.js';
