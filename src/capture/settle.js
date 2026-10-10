// Settlement uses the existing capture context and does not navigate (R4.2).
export async function settlePage({ page, recipe, active = () => true }) {
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
  if (!recipe.lazyImages) return;
  await page.evaluate(async () => {
    const initial = { x: scrollX, y: scrollY };
    const maxHeight = 30000, maxSteps = 50;
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const initialHeight = document.documentElement.scrollHeight;
      if (initialHeight > maxHeight) throw new Error('Lazy-image page exceeds the settlement height limit.');
      if (innerHeight <= 0 || Math.ceil(initialHeight / innerHeight) + 1 > maxSteps) throw new Error('Lazy-image page exceeds the settlement step limit.');
      for (let step = 0, y = 0; ; step++, y += innerHeight) {
        if (document.documentElement.scrollHeight > initialHeight) throw new Error('Lazy-image page grows during settlement.');
        if (y > initialHeight) break;
        if (step >= maxSteps) throw new Error('Lazy-image page exceeds the settlement step limit.');
        scrollTo(0, y); await pause();
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
    } finally { scrollTo(initial.x, initial.y); }
  });
  check();
  } finally { if (guarded) page.off('request', onRequest); }
}
