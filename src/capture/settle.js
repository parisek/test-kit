// R5.15: the failure of an afterSweep selector. It names the selector, and its code keeps the retry of R5.14 away:
// a page that never returns to the declared state is a page defect, not a transient fault.
export function afterSweepError(selector) {
  return Object.assign(new Error(`The afterSweep selector ${JSON.stringify(selector)} matches no visible element after the lazy-image sweep. Fix settle.afterSweep or the page.`), { code: 'AFTER_SWEEP_NOT_VISIBLE' });
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
  await page.evaluate(async () => {
    const initial = { x: scrollX, y: scrollY };
    const maxHeight = 30000, maxSteps = 50;
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // `behavior: 'instant'` ignores a `scroll-behavior: smooth` of the page, so each scroll lands before the next step (#353).
    const scroll = (left, top) => scrollTo({ left, top, behavior: 'instant' });
    try {
      const initialHeight = document.documentElement.scrollHeight;
      if (initialHeight > maxHeight) throw new Error('Lazy-image page exceeds the settlement height limit.');
      if (innerHeight <= 0 || Math.ceil(initialHeight / innerHeight) + 1 > maxSteps) throw new Error('Lazy-image page exceeds the settlement step limit.');
      for (let step = 0, y = 0; ; step++, y += innerHeight) {
        if (document.documentElement.scrollHeight > initialHeight) throw new Error('Lazy-image page grows during settlement.');
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
      if (document.documentElement.scrollHeight > initialHeight) throw new Error('Lazy-image page grows during settlement.');
    } finally { scroll(initial.x, initial.y); }
  });
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
