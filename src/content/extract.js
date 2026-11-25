import { EXTRACTOR_VERSION, MAX_ITEMS, MAX_TEXT, validateContentSnapshot } from './snapshot.js';

// The extractor reads the current page. It performs no navigation or request.
// #442: with a scope selector, text, headings, images and links come from the first match of each selector.
// Title and lang stay of the page. A selector without a match fails the read.
// The match uses a Playwright locator, like the screenshot scope. The capture resolves the scope once
// and passes the same handles to the snapshot and to the body.
export async function scopeElements(page, selector) {
  const handles = [];
  for (const item of Array.isArray(selector) ? selector : [selector]) {
    const handle = await page.locator(item).first().elementHandle({ timeout: 1000 }).catch(() => null);
    if (!handle) throw new Error('A scope selector matches no element.');
    handles.push(handle);
  }
  // A match inside another match, or a repeated match, adds nothing: the scope is a set of elements.
  const keep = await page.evaluate(nodes => nodes.map((node, index) => !nodes.some((other, at) => other !== node ? other.contains(node) : at < index)), handles);
  return handles.filter((handle, index) => keep[index]);
}

export async function extractContentSnapshot(page, roots = null) {
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
  }, { version: EXTRACTOR_VERSION, maxItems: MAX_ITEMS, maxText: MAX_TEXT, scope: roots });
  return validateContentSnapshot(value);
}
