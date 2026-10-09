import { EXTRACTOR_VERSION, MAX_ITEMS, MAX_TEXT, validateContentSnapshot } from './snapshot.js';

// The extractor reads the current page. It performs no navigation or request.
export async function extractContentSnapshot(page) {
  const value = await page.evaluate(({ version, maxItems, maxText }) => {
    const short = (value, max = 2000) => String(value ?? '').slice(0, max);
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const images = [...document.querySelectorAll('img')];
    const links = [...document.querySelectorAll('a[href]')].flatMap(node => {
      try {
        const url = new URL(node.getAttribute('href'), document.baseURI);
        return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)
          ? [{ path: url.pathname + url.search, text: short(node.textContent) }] : [];
      } catch { return []; }
    });
    const rawText = document.body?.innerText ?? '';
    return { schemaVersion: 1, extractorVersion: version, source: 'settled-dom',
      title: short(document.title), lang: short(document.documentElement.lang, 100), text: short(rawText, maxText),
      headings: headings.slice(0, maxItems).map(node => ({ level: Number(node.tagName.slice(1)), text: short(node.textContent) })),
      images: images.slice(0, maxItems).map(node => ({ src: short(node.getAttribute('src')), alt: node.hasAttribute('alt') ? short(node.getAttribute('alt')) : null, role: short(node.getAttribute('role'), 100) })),
      links: links.slice(0, maxItems),
      omitted: { headings: Math.max(0, headings.length - maxItems), images: Math.max(0, images.length - maxItems), links: Math.max(0, links.length - maxItems), text: rawText.length > maxText } };
  }, { version: EXTRACTOR_VERSION, maxItems: MAX_ITEMS, maxText: MAX_TEXT });
  return validateContentSnapshot(value);
}
