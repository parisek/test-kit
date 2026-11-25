// R5.15: the failure of an afterSweep selector. It names the selector, and its code keeps the retry of R5.14 away:
// a page that never returns to the declared state is a page defect, not a transient fault.
export function afterSweepError(selector) {
  return Object.assign(new Error(`The afterSweep selector ${JSON.stringify(selector)} matches no visible element after the lazy-image sweep. Fix settle.afterSweep or the page.`), { code: 'AFTER_SWEEP_NOT_VISIBLE' });
}

// #413, R5.9: the growth failure of the sweep, with both heights. The page script throws a plain message, so the
// capture rebuilds it here from two integers: no page text reaches the stored message.
const GROWS = /Lazy-image page grows during settlement \((\d{1,9}) px to (\d{1,9}) px\)/;
export function lazyGrowthError(error) {
  const match = GROWS.exec(String(error?.message ?? ''));
  if (!match) return error;
  return Object.assign(new Error(`Lazy-image page grows during settlement (${Number(match[1])} px to ${Number(match[2])} px). Set settle.lazyImages only on targets with native lazy images.`), { code: 'LAZY_PAGE_GROWS' });
}

// Settlement uses the existing capture context and does not navigate (R4.2).
// `progress.afterSweep` holds the afterSweep selector that capture waits for, so a capture deadline during that wait names it.
export async function settlePage({ page, recipe, active = () => true, progress = {} }) {
  if (!Array.isArray(recipe.reveal ?? []) || (recipe.reveal ?? []).length > 20) throw new Error('Capture settlement accepts at most 20 reveal steps.');
  const initialUrl = page.url();
  let navigation = false;
  const onRequest = request => {
    if (!request.isNavigationRequest()) return;
    try { if (request.frame() === page.mainFrame()) navigation = true; } catch { navigation = true; }
  };
  const guarded = (recipe.reveal?.length > 0) || recipe.lazyImages;
  if (guarded) page.on('request', onRequest);
  try {
  const check = () => { if (!active()) throw new Error('Capture settlement is no longer active.'); if (navigation || page.url() !== initialUrl) throw new Error('Reveal changes the capture URL.'); };
  for (const step of recipe.reveal ?? []) {
    check();
    const locator = page.locator(step.selector).first();
    if (!['click', 'hover', 'focus'].includes(step.action)) throw new Error('Unsupported reveal action.');
    await locator[step.action]();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check();
  }
  for (const selector of recipe.selectors ?? []) { check(); await page.locator(selector).first().waitFor({ state: 'visible' }); }
  check();
  await page.evaluate(async () => { await document.fonts.ready; });
  if (recipe.waitMs) await page.waitForTimeout(recipe.waitMs);
  check();
  // R5.12: pin runs after the wait steps and before the lazy-image sweep. It sets one fixed declaration and sends no request.
  if ((recipe.pin ?? []).length > 20) throw new Error('Capture settlement accepts at most 20 pin selectors.');
  for (const selector of recipe.pin ?? []) {
    check();
    const count = await page.locator(selector).evaluateAll(elements => {
      for (const element of elements) element.style.setProperty('position', 'static', 'important');
      return elements.length;
    });
    if (count === 0) throw Object.assign(new Error(`The pin selector ${JSON.stringify(selector)} matches no element. Fix settle.pin or remove it.`), { code: 'PIN_NO_MATCH' });
  }
  check();
  if (!recipe.lazyImages) return;
  try { await page.evaluate(async () => {
    const initial = { x: scrollX, y: scrollY };
    const maxHeight = 30000, maxSteps = 50;
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // `behavior: 'instant'` ignores a `scroll-behavior: smooth` of the page, so each scroll lands before the next step (#353).
    const scroll = (left, top) => scrollTo({ left, top, behavior: 'instant' });
    try {
      const initialHeight = document.documentElement.scrollHeight;
      if (initialHeight > maxHeight) throw new Error('Lazy-image page exceeds the settlement height limit.');
      if (innerHeight <= 0 || Math.ceil(initialHeight / innerHeight) + 1 > maxSteps) throw new Error('Lazy-image page exceeds the settlement step limit.');
      // #413: the message names both heights, so a person sees how much the page grew. The heights are numbers, never page text.
      const grown = () => { const height = document.documentElement.scrollHeight; if (height > initialHeight) throw new Error(`Lazy-image page grows during settlement (${initialHeight} px to ${height} px).`); };
      for (let step = 0, y = 0; ; step++, y += innerHeight) {
        grown();
        if (y > initialHeight) break;
        if (step >= maxSteps) throw new Error('Lazy-image page exceeds the settlement step limit.');
        scroll(0, y); await pause();
      }
      const images = [...document.images].filter(image => image.getClientRects().length > 0);
      if (images.length > 1000) throw new Error('Lazy-image page exceeds the image limit.');
      for (const image of images) if (image.loading === 'lazy') image.loading = 'eager';
      await Promise.all(images.map(image => new Promise(resolve => {
        if (image.complete) { resolve(); return; }
        const complete = () => { clearTimeout(timer); image.removeEventListener('load', complete); image.removeEventListener('error', complete); resolve(); };
        const timer = setTimeout(complete, 2000);
        image.addEventListener('load', complete, { once: true }); image.addEventListener('error', complete, { once: true });
      })));
      if (images.some(image => !image.complete)) throw new Error('Lazy image does not finish loading within the settlement limit.');
      const decoded = await Promise.all(images.filter(image => image.naturalWidth > 0).map(async image => {
        let timer;
        try { return await Promise.race([image.decode().then(() => true, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]); }
        finally { clearTimeout(timer); }
      }));
      if (decoded.some(value => !value)) throw new Error('Lazy image does not finish decoding within the settlement limit.');
      await document.fonts.ready;
      await pause();
      grown();
    } finally { scroll(initial.x, initial.y); }
  }); } catch (error) { throw lazyGrowthError(error); }
  check();
  // R5.15: after the restore, wait for the state the page returns to on its own time (a debounced scroll listener, a timer).
  if ((recipe.afterSweep ?? []).length > 20) throw new Error('Capture settlement accepts at most 20 afterSweep selectors.');
  for (const selector of recipe.afterSweep ?? []) {
    check();
    progress.afterSweep = selector;
    try { await page.locator(selector).first().waitFor({ state: 'visible' }); } catch (error) {
      if (error?.name === 'TimeoutError') throw afterSweepError(selector);
      throw error;
    }
    delete progress.afterSweep;
  }
  if ((recipe.afterSweep ?? []).length > 0) {
    check();
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  }
  check();
  } finally { if (guarded) page.off('request', onRequest); }
}

// R5.11: the count of visible lazy images that are not loaded. Read only: it changes nothing on the page.
// With a `selector` (a string or a list), it counts the images inside the first match of each selector, each image once.
// A read that fails gives 0, so a warning never fails a capture.
export async function countUnloadedLazyImages(page, selector) {
  const handles = [];
  try {
    let count;
    if (selector === undefined) count = await page.evaluate(() => [...document.images].filter(image => image.loading === 'lazy' && !image.complete && image.getClientRects().length > 0).length);
    else {
      for (const value of Array.isArray(selector) ? selector : [selector]) handles.push(await page.locator(value).first().elementHandle({ timeout: 1000 }));
      count = await page.evaluate(elements => {
        const found = new Set();
        for (const element of elements) for (const image of element.localName === 'img' ? [element] : element.querySelectorAll('img')) {
          if (image.loading === 'lazy' && !image.complete && image.getClientRects().length > 0) found.add(image);
        }
        return found.size;
      }, handles);
    }
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  } catch { return 0; } finally { for (const handle of handles) await handle.dispose().catch(() => {}); }
}

// R5.17: the highest match count of the scope selectors (a string or a list). Read only: it changes nothing on the page.
// A page target has no scope selector and gives 0. A read that fails gives 0, so a warning never fails a capture.
export async function countSelectorMatches(page, selector) {
  if (selector === undefined) return 0;
  try {
    let most = 0;
    for (const value of Array.isArray(selector) ? selector : [selector]) most = Math.max(most, await page.locator(value).count());
    return Number.isSafeInteger(most) && most > 0 ? most : 0;
  } catch { return 0; }
}

// R5.18: the rectangles that the masks and the captured area hold, in document coordinates. Read only.
// The captured area is the bounding box of the first match of each scope selector, else the full page
// (`fullPage`) or the viewport. It gives null when there is no mask or a read fails, so a warning never fails a capture.
export async function readMaskCover(page, { selector, masks, fullPage }) {
  if (!Array.isArray(masks) || !masks.length) return null;
  try {
    const toDocument = elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }; });
    const rects = [];
    for (const mask of masks) rects.push(await page.locator(mask).evaluateAll(toDocument));
    let area;
    if (selector !== undefined) {
      const boxes = [];
      for (const value of Array.isArray(selector) ? selector : [selector]) boxes.push(...await page.locator(value).first().evaluateAll(toDocument));
      if (!boxes.length) return null;
      const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
      area = { x: left, y: top, width: Math.max(...boxes.map(box => box.x + box.width)) - left, height: Math.max(...boxes.map(box => box.y + box.height)) - top };
    } else area = await page.evaluate(full => full
      ? { x: 0, y: 0, width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, innerWidth), height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight) }
      : { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight }, fullPage === true);
    return { masks: rects, area };
  } catch { return null; }
}
