// R5.21: the style sheet that hides the matches of `settle.hide` during the screenshot.
// Pure (R4.4). The configuration refuses a brace in a selector, so one selector cannot end its rule.
export function hideStyle(selectors) {
  if (!Array.isArray(selectors) || !selectors.length) return '';
  for (const selector of selectors) if (typeof selector !== 'string' || /[{}]/.test(selector)) throw new Error('Invalid hide selector.');
  return selectors.map(selector => `${selector} { visibility: hidden !important; }`).join('\n');
}
