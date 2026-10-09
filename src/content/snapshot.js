export const EXTRACTOR_VERSION = '1.0.0';
export const MAX_ITEMS = 1000;
export const MAX_TEXT = 100000;
const text = (value, max) => typeof value === 'string' && value.length <= max;
export function validateContentSnapshot(value) {
  const bad = () => { throw new Error('Invalid content snapshot.'); };
  if (!value || value.schemaVersion !== 1 || value.extractorVersion !== EXTRACTOR_VERSION
    || value.source !== 'settled-dom' || !text(value.title, 2000) || !text(value.lang, 100)
    || !text(value.text, MAX_TEXT) || !value.omitted) bad();
  for (const key of ['headings', 'images', 'links']) {
    if (!Array.isArray(value[key]) || value[key].length > MAX_ITEMS
      || !Number.isSafeInteger(value.omitted[key]) || value.omitted[key] < 0 || value.omitted[key] > 1000000) bad();
  }
  if (typeof value.omitted.text !== 'boolean') bad();
  const headings = value.headings.map(item => {
    if (!item || !Number.isInteger(item.level) || item.level < 1 || item.level > 6 || !text(item.text, 2000)) bad();
    return { level: item.level, text: item.text };
  });
  const images = value.images.map(item => {
    if (!item || !text(item.src, 2000) || !(item.alt === null || text(item.alt, 2000))
      || !text(item.role, 100)) bad();
    return { src: item.src, alt: item.alt, role: item.role };
  });
  const links = value.links.map(item => {
    if (!item || !text(item.path, 2000) || !item.path.startsWith('/') || item.path.startsWith('//')
      || /[\x00-\x1f\x7f]/.test(item.path) || !text(item.text, 2000)) bad();
    return { path: item.path, text: item.text };
  });
  return { schemaVersion: 1, extractorVersion: EXTRACTOR_VERSION, source: 'settled-dom',
    title: value.title, lang: value.lang, text: value.text, headings, images, links,
    omitted: { headings: value.omitted.headings, images: value.omitted.images, links: value.omitted.links, text: value.omitted.text } };
}

