import { targetPath } from '../capture/helpers.js';
import { performanceSettings, performanceConsent, evaluateBudgets } from './model.js';

export function planPerfCommand(config, { side, label = '', targetIds, runs, formFactor, throttling, consent = false, budgets = {} } = {}) {
  if (!Object.hasOwn(config.sides, side)) throw new Error('Performance needs a configured side.');
  if (typeof label !== 'string' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Performance label must be bounded text.');
  if (!Array.isArray(targetIds) || !targetIds.length || targetIds.length > 1000
    || new Set(targetIds).size !== targetIds.length || targetIds.some(id => typeof id !== 'string')) throw new Error('Performance needs explicit unique target IDs.');
  const targets = targetIds.map(id => {
    const target = config.targets.find(target => target.id === id);
    if (!target) throw new Error(`Unknown performance target: ${id}`);
    if (target.kind !== 'page') throw new Error('Lighthouse measures full pages. Component targets are unsupported.');
    return target;
  });
  const settings = performanceSettings({ runs, formFactor, throttling });
  const cost = performanceConsent(targets.length, settings, consent);
  evaluateBudgets(null, budgets);
  const origin = new URL(config.sides[side].origin);
  if (origin.protocol !== 'http:') throw new Error('Performance accepts local HTTP only. HTTPS is unsupported.');
  const dimensions = settings.screenEmulation;
  const matching = config.viewports.find(viewport => viewport.id === settings.formFactor && viewport.width === dimensions.width
    && viewport.height === dimensions.height && viewport.deviceScaleFactor === dimensions.deviceScaleFactor);
  const viewport = { id: matching?.id ?? 'performance', width: dimensions.width, height: dimensions.height, deviceScaleFactor: dimensions.deviceScaleFactor };
  return { targets, settings, cost, viewport, settingsConfig: { ...config, targets, viewports: [viewport], artifacts: ['lighthouse'], checks: [] },
    urls: targets.map(target => ({ id: target.id, url: new URL(targetPath(target, side), origin).href })) };
}

