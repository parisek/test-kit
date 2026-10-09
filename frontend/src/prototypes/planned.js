// Opt-in UI fixtures. These are not capture results or acceptance evidence.
export const PROTOTYPE_MARKER = 'planned-artifacts-v1';
export const PLANNED_KINDS = ['behavior', 'content', 'lighthouse'];
export const hasPrototypes = report => report?.meta?.prototype === PROTOTYPE_MARKER;
export function plannedSample(report, targetId, viewportId, kind) {
  if (!hasPrototypes(report) || !PLANNED_KINDS.includes(kind)
    || !report.entries.some(target => target.id === targetId && target.viewports.some(row => row.id === viewportId))) return null;
  const component = ['button', 'card'].includes(targetId);
  if (kind === 'behavior') return { steps: [
    { title: component ? 'Reach the primary action with Tab' : 'Open navigation with the keyboard', state: 'same', a: 'Focus is visible. Enter opens the control.', b: 'Focus is visible. Enter opens the control.' },
    { title: component ? 'Activate the primary action' : 'Close navigation with Escape', state: targetId === 'home' ? 'failed' : 'changed', a: 'The control closes. Focus returns to its trigger.', b: targetId === 'home' ? 'The control stays open. Focus is lost.' : 'The control closes. A new event is emitted.', console: targetId === 'home' ? ['TypeError: demo close handler is missing'] : [], network: ['GET /example-action → 200 (simulated)'], dataLayer: ['A: action_open', 'B: action_open, action_close'] },
    { title: 'Verify the confirmation state', state: 'skipped', a: 'Not simulated', b: targetId === 'home' ? 'Blocked by the previous failed step.' : 'This confirmation step is not simulated yet.' },
  ] };
  if (kind === 'content') return { checks: [
    { title: 'Heading outline', state: 'failed', severity: 'error', selector: 'main h3', a: 'h1 → h2 → h3', b: 'h1 → h3', message: 'The illustrative outline skips heading level 2.' },
    { title: 'Page language', state: 'passed', severity: 'info', selector: 'html[lang]', a: 'en', b: 'en', message: 'The declared language matches the expected language.' },
    { title: 'Image alternatives', state: 'failed', severity: 'warning', selector: '.hero img', a: 'Descriptive alternative text', b: 'Missing alt attribute', message: 'A missing alternative differs from an explicit decorative empty alt.' },
    { title: 'Internal links', state: 'failed', severity: 'error', selector: 'a[href="/example-missing"]', a: '200', b: '404', message: 'This simulated check covers stored local links only.' },
    { title: 'Text comparison', state: 'passed', severity: 'info', selector: 'main', a: 'Stored text is available', b: 'Stored text is available', message: 'The real HTML tab holds captured response differences.' },
    { title: 'Detected language', state: 'skipped', severity: 'info', selector: 'main', a: 'Not run', b: 'Not run', message: 'The detector and its library are not implemented.' },
  ] };
  return { compatible: targetId !== 'catalogue', reason: 'The form factor or throttling settings differ. A regression cannot be derived.', suspect: targetId === 'support',
    settings: { formFactor: viewportId === 'mobile' ? 'mobile' : 'desktop', throttling: 'Illustrative fixed preset', warmup: 'One discarded request (simulated)' },
    metrics: [
      { title: 'Largest Contentful Paint', unit: 'ms', a: [1750, 1800, 1850], b: [2600, 2700, 2900], budget: 2500 },
      { title: 'Total Blocking Time', unit: 'ms', a: [90, 110, 130], b: [150, 180, 220], budget: 200 },
      { title: 'Cumulative Layout Shift', unit: 'score', a: [0.02, 0.03, 0.04], b: [0.05, 0.07, 0.08], budget: 0.1 },
    ] };
}
