// The browser half of the layout artifact (R6.14). It reads raw computed values from the open page.
// It does not navigate and sends no request. It adds one hidden probe element to resolve the
// custom properties on `:root`, and removes it before it returns. Normalisation is pure (`record.js`).
import { RECORD_PROPERTIES, LAYOUT_VERSION, normaliseRecord, tokenTable } from './record.js';
import { MAX_REPEAT } from './declaration.js';
import { MAX_COUNT } from './snapshot.js';

export const MAX_TOKENS = 2000;

// Runs in the page. Keep it self-contained: Playwright serialises the function.
function readPage({ parts, properties, maxRepeat, maxCount, maxTokens }) {
  const read = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const raw = { rect: { width: rect.width, height: rect.height } };
    for (const property of properties) raw[property] = style[property];
    return raw;
  };
  const result = { parts: [], tokens: [], badSelector: null };
  for (const part of parts) {
    let matches;
    try { matches = part.repeat ? document.querySelectorAll(part.selector) : [document.querySelector(part.selector)].filter(Boolean); }
    catch { result.badSelector = part.id; return result; }
    const count = Math.min(matches.length, maxCount);
    result.parts.push({ id: part.id, repeat: part.repeat === true, count, raw: Array.from(matches).slice(0, maxRepeat).map(read) });
  }
  // The custom properties on `:root`: the names the style sheets declare there, and the names the computed style lists.
  const names = new Set();
  const walk = rules => {
    for (const rule of rules) {
      if (names.size >= maxTokens) return;
      if (rule.selectorText && /(^|,)\s*(:root|html)\b/.test(rule.selectorText)) {
        for (const name of rule.style) if (name.startsWith('--')) names.add(name);
      }
      let inner = null;
      try { inner = rule.cssRules; } catch { inner = null; }
      if (inner) walk(inner);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { rules = null; }
    if (rules) walk(rules);
  }
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of rootStyle) { if (names.size >= maxTokens) break; if (name.startsWith('--')) names.add(name); }
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'display:none;color:rgb(1, 2, 3)';
  const probe = document.createElement('div');
  host.append(probe);
  document.documentElement.append(host);
  try {
    for (const name of [...names].sort().slice(0, maxTokens)) {
      probe.style.cssText = `width:var(${name});color:var(${name})`;
      const style = getComputedStyle(probe);
      const width = style.width, color = style.color;
      result.tokens.push({ name, length: width === 'auto' ? null : width, colour: color === 'rgb(1, 2, 3)' ? null : color });
    }
  } finally { host.remove(); }
  return result;
}

// The layout snapshot of one target: one record per part, or per element of a repeat part.
export async function extractLayoutSnapshot(page, declaration) {
  const raw = await page.evaluate(readPage, { parts: declaration.parts, properties: RECORD_PROPERTIES, maxRepeat: MAX_REPEAT, maxCount: MAX_COUNT, maxTokens: MAX_TOKENS });
  if (raw.badSelector) {
    const error = new Error(`Layout part ${raw.badSelector} has an invalid selector.`);
    error.code = 'LAYOUT_SELECTOR_INVALID';
    throw error;
  }
  return layoutSnapshot(raw);
}

// Pure: the raw page values to the stored snapshot shape.
export function layoutSnapshot(raw) {
  const table = tokenTable(raw.tokens);
  return { schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style',
    parts: raw.parts.map(part => ({ id: part.id, repeat: part.repeat, count: part.count, records: part.raw.map(item => normaliseRecord(item, table)) })) };
}
