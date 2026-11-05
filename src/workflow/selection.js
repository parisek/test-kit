import { validateContractSelection } from '../behavior/contracts.js';
import { builtinChecks } from '../checks/index.js';
import { DEFAULT_ARTIFACTS } from '../config/normalize.js';

import { parseIdList as ids } from '../capture/selection.js';

export function selectConfig(input, options = {}) {
  const config = structuredClone(input);
  const suite = options.suite ?? (options.selector ? 'visual' : 'all');
  const suites = { all: input.artifacts ?? DEFAULT_ARTIFACTS, visual: ['screenshot', 'status'], content: ['content', 'status'], behavior: ['behavior', 'status'] };
  if (!suites[suite]) throw new Error('Unknown suite. Use all, visual, content, or behavior.');
  if (options.target && options.path) throw new Error('Use target or path.');
  if (options.target) {
    const selected = ids(options.target, 'target');
    // The styleguide catalogue is read at capture. Capture reports an unknown component by name.
    if (input.targetSource) config.targetSource = { ...input.targetSource, include: selected };
    else {
      if (selected.some(id => !input.targets.some(target => target.id === id))) throw new Error('Unknown target.');
      config.targets = input.targets.filter(target => selected.includes(target.id));
    }
  }
  if (options.path) {
    if (!options.path.startsWith('/') || options.path.startsWith('//') || /[\\\s#\x00-\x1f]/.test(options.path)) throw new Error('Use an origin-relative page path.');
    config.targets = [{ id: 'custom-page', kind: 'page', path: options.path }];
    delete config.targetSource;
  }
  if (options.selector) {
    if (config.targets?.length !== 1 || suite !== 'visual') throw new Error('A selector requires one target and the visual suite.');
    if (typeof options.selector !== 'string' || options.selector.length > 2048 || /[\x00-\x1f]/.test(options.selector)) throw new Error('Invalid selector.');
    config.targets[0] = { ...config.targets[0], kind: 'component', selector: options.selector };
    delete config.targets[0].box;
  }
  if (options.viewport) {
    const selected = ids(options.viewport, 'viewport');
    if (selected.some(id => !input.viewports.some(viewport => viewport.id === id))) throw new Error('Unknown viewport.');
    config.viewports = input.viewports.filter(viewport => selected.includes(viewport.id));
  }
  config.artifacts = [...suites[suite]];
  if (options.checks) {
    if (!config.artifacts.includes('content')) throw new Error('Checks require the content artifact.');
    config.checks = options.checks === 'none' ? [] : ids(options.checks, 'check');
    if (config.checks.some(id => !Object.hasOwn(builtinChecks, id))) throw new Error('Unknown content check.');
  }
  if (!config.artifacts.includes('content')) config.checks = [];
  if (options.contracts && !config.artifacts.includes('behavior')) throw new Error('Contracts require the behavior artifact.');
  if (!config.artifacts.includes('behavior')) delete config.behavior;
  else {
    if (!config.behavior) throw new Error('Configure behavior before selecting this suite.');
    if (config.behavior.projects) config.behavior.projects = Object.fromEntries(Object.entries(config.behavior.projects).filter(([id]) => config.viewports.some(viewport => viewport.id === id)));
    if (options.contracts) config.behavior.enabled = options.contracts === 'none' ? [] : validateContractSelection(options.contracts.split(','));
  }
  return config;
}
