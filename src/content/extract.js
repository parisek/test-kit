import { EXTRACTOR_VERSION, MAX_ITEMS, MAX_TEXT, validateContentSnapshot } from './snapshot.js';

// The extractor reads the current page. It performs no navigation or request.
// #442: with a scope selector, text, headings, images and links come from the first match of each selector.
// Title and lang stay of the page. A selector without a match fails the read.
// The match uses a Playwright locator, like the screenshot scope.
export async function scopeElements(page, selector) {
  const handles = [];
  for (const item of Array.isArray(selector) ? selector : [selector]) {
    const locator = page.locator(item).first();
    if (await locator.count() === 0) throw new Error('A scope selector matches no element.');
    handles.push(await locator.elementHandle());
  }
  return handles;
}

export async function extractContentSnapshot(page, selector = null) {
  const scope = selector === null ? null : await scopeElements(page, selector);
  const value = await page.evaluate(({ version, maxItems, maxText, scope }) => {
    const roots = scope ?? [document];
    if (roots.some(root => !root)) throw new Error('A scope selector matches no element.');
    const all = query => roots.flatMap(root => [...(root.matches?.(query) ? [root] : []), ...root.querySelectorAll(query)]);
    const short = (value, max = 2000) => String(value ?? '').slice(0, max);
    // A heading is hidden by display, visibility, a hidden or aria-hidden ancestor, or a zero box (R7.5).
    const isHidden = node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || Boolean(node.closest('[hidden],[aria-hidden="true"]')) || box.width === 0 || box.height === 0;
    };
    const headings = all('h1,h2,h3,h4,h5,h6');
    const images = all('img');
    const links = all('a[href]').flatMap(node => {
      try {
        const url = new URL(node.getAttribute('href'), document.baseURI);
        return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)
          ? [{ path: url.pathname + url.search, text: short(node.textContent) }] : [];
      } catch { return []; }
    });
    const rawText = scope ? roots.map(root => root.innerText ?? '').join('\n') : document.body?.innerText ?? '';
    return { schemaVersion: 1, extractorVersion: version, source: 'settled-dom',
      title: short(document.title), lang: short(document.documentElement.lang, 100), text: short(rawText, maxText),
      headings: headings.slice(0, maxItems).map(node => ({ level: Number(node.tagName.slice(1)), text: short(node.textContent), ...(isHidden(node) ? { hidden: true } : {}) })),
      images: images.slice(0, maxItems).map(node => ({ src: short(node.getAttribute('src')), alt: node.hasAttribute('alt') ? short(node.getAttribute('alt')) : null, role: short(node.getAttribute('role'), 100) })),
      links: links.slice(0, maxItems),
      omitted: { headings: Math.max(0, headings.length - maxItems), images: Math.max(0, images.length - maxItems), links: Math.max(0, links.length - maxItems), text: rawText.length > maxText } };
  }, { version: EXTRACTOR_VERSION, maxItems: MAX_ITEMS, maxText: MAX_TEXT, scope });
  return validateContentSnapshot(value);
}
