import { assertImageBounds } from './helpers.js';
import { scopeGeometry } from './scope-geometry.js';
export { scopeGeometry } from './scope-geometry.js';

function selectorsOf(selector) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  if (!selectors.length || selectors.length > 50 || selectors.some(value => typeof value !== 'string' || !value.trim() || value.length > 2048)) throw new Error('Scope needs 1..50 bounded selectors.');
  return selectors;
}

// One string and border box retain the existing element screenshot path.
export async function captureScopedScreenshot({ page, selector, box = 'border', options = {} }) {
  const selectors = selectorsOf(selector);
  if (!['border', 'content'].includes(box)) throw new Error('Scope box must be border or content.');
  if (!Array.isArray(selector) && box === 'border') {
    const locator = page.locator(selectors[0]).first();
    await locator.waitFor({ state: 'visible', timeout: options.timeout });
    const rect = await locator.boundingBox();
    if (!rect) throw new Error('Scope has no visible area.');
    const viewport = await page.evaluate(() => ({ dpr: devicePixelRatio }));
    assertImageBounds(rect.width, rect.height, viewport.dpr);
    const { clip, fullPage, ...elementOptions } = options;
    return { bytes: await locator.screenshot(elementOptions), geometry: { mode: 'element', box, unit: 'css-px', width: rect.width, height: rect.height } };
  }
  const assertStableAnimationGeometry = async () => {
    if (options.animations !== 'disabled') return;
    const active = await page.evaluate(() => {
      const roots = [document];
      for (let index = 0; index < roots.length; index++) {
        for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
      }
      return roots.some(root => root.getAnimations().some(animation => animation.pending || !['finished', 'idle'].includes(animation.playState)));
    });
    if (active) throw new Error('Scoped geometry requires settled animations before capture.');
  };
  await assertStableAnimationGeometry();
  const rectangles = [];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: options.timeout });
    const rect = await locator.evaluate((element, box) => {
      if (box === 'content') {
        for (let node = element; node; node = node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null) {
          const style = getComputedStyle(node);
          const transform = style.transform;
          const identityTransform = transform === 'none' || new DOMMatrixReadOnly(transform).isIdentity;
          const identityScale = style.scale === 'none' || style.scale.split(/\s+/).every(value => Number(value) === 1);
          const identityRotate = style.rotate === 'none' || Number.parseFloat(style.rotate.split(/\s+/).at(-1)) === 0;
          const identityTranslate = style.translate === 'none' || style.translate.split(/\s+/).every(value => Number.parseFloat(value) === 0);
          const identityZoom = style.zoom === 'normal' || Number(style.zoom) === 1;
          if (!identityTransform || !identityScale || !identityRotate || !identityTranslate || !identityZoom) throw new Error('Content scope does not support transformed or zoomed elements or ancestors.');
        }
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (box === 'content' && (style.scrollbarGutter !== 'auto' || [style.overflowX, style.overflowY].some(value => ['auto', 'scroll'].includes(value)))) throw new Error('Content scope does not support scroll containers or reserved scrollbar gutters.');
      const edge = key => Number.parseFloat(style[key]) || 0;
      const left = box === 'content' ? edge('borderLeftWidth') + edge('paddingLeft') : 0;
      const top = box === 'content' ? edge('borderTopWidth') + edge('paddingTop') : 0;
      const right = box === 'content' ? edge('borderRightWidth') + edge('paddingRight') : 0;
      const bottom = box === 'content' ? edge('borderBottomWidth') + edge('paddingBottom') : 0;
      return { x: rect.x + scrollX + left, y: rect.y + scrollY + top, width: rect.width - left - right, height: rect.height - top - bottom };
    }, box);
    rectangles.push(rect);
  }
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollX, scrollY, dpr: devicePixelRatio }));
  const geometry = scopeGeometry(rectangles, viewport, { box });
  assertImageBounds(geometry.clip.width, geometry.clip.height, viewport.dpr);
  await assertStableAnimationGeometry();
  const bytes = await page.screenshot({ ...options, clip: geometry.clip, fullPage: geometry.fullPage });
  return { bytes, geometry };
}
