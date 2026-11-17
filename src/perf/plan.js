import { targetPath } from '../capture/helpers.js';
import { performanceSettings, performanceConsent, evaluateBudgets } from './model.js';

export function planPerfCommand(config, { side, label = '', targetIds, runs, formFactor, throttling, consent = false, budgets = {} } = {}) {
  if (!Object.hasOwn(config.sides, side)) throw new Error('Performance needs a configured side.');
  if (config.sides[side].kind === 'design') throw new Error('Performance needs a browser side. A design side holds images.');
  // R8.7: the styleguide source yields component targets only. Lighthouse measures a full page, so this is an explicit non-pass.
  if (config.targetSource) throw new Error('Lighthouse measures full pages. Component targets from the styleguide are unsupported.');
  if (typeof label !== 'string' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Performance label must be bounded text.');
  if (!Array.isArray(targetIds) || !targetIds.length || targetIds.length > 1000
    || new Set(targetIds).size !== targetIds.length || targetIds.some(id => typeof id !== 'string')) throw new Error('Performance needs explicit unique target IDs.');
  const targets = targetIds.map(id => {
    const target = config.targets.find(target => target.id === id);
    if (!target) throw new Error(`Unknown performance target: ${id}`);
    if (target.kind !== 'page') throw new Error('Lighthouse measures full pages. Component targets are unsupported.');
    return target;
  });
  // R3.3, R6.16 (#383): a local or a remote side, over HTTP or HTTPS. The request policy of the side enters the settings.
  const sideConfig = config.sides[side];
  const network = { origin: new URL(sideConfig.origin).origin, remote: sideConfig.remote === true,
    allowOrigins: (sideConfig.allowOrigins ?? []).map(entry => entry.origin), blockPaths: sideConfig.perfBlockPaths ?? [],
    ...(sideConfig.userAgent ? { userAgent: sideConfig.userAgent } : {}), ...(sideConfig.challenge ? { challenge: sideConfig.challenge } : {}) };
  const settings = performanceSettings({ runs, formFactor, throttling, network: { allowOrigins: network.allowOrigins, blockPaths: network.blockPaths } });
  const cost = performanceConsent(targets.length, settings, consent, { production: sideConfig.production === true });
  evaluateBudgets(null, budgets);
  const origin = new URL(network.origin);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Performance accepts an HTTP or HTTPS origin only.');
  const dimensions = settings.screenEmulation;
  const matching = config.viewports.find(viewport => viewport.id === settings.formFactor && viewport.width === dimensions.width
    && viewport.height === dimensions.height && viewport.deviceScaleFactor === dimensions.deviceScaleFactor);
  const viewport = { id: matching?.id ?? 'performance', width: dimensions.width, height: dimensions.height, deviceScaleFactor: dimensions.deviceScaleFactor };
  return { targets, settings, cost, viewport, network, settingsConfig: { ...config, targets, viewports: [viewport], artifacts: ['lighthouse'], checks: [] },
    urls: targets.map(target => ({ id: target.id, url: new URL(targetPath(target, side), origin).href })) };
}

