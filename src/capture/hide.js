// R5.21: the style sheet that hides the matches of `settle.hide` during the screenshot.
// Pure (R4.4). All rules share one style sheet, so one selector must not end its rule,
// start another, or leave a bracket, a parenthesis or a quote open: an open one swallows
// every later rule.
const RULE_BREAK = /[{};@]|\/\*|\*\//;

export function hideSelectorProblem(selector) {
  if (typeof selector !== 'string') return 'must be a string';
  if (RULE_BREAK.test(selector)) return 'must not hold {, }, ;, @, /* or */';
  const open = [];
  let quote = null;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (char === '\\') {
      if (index === selector.length - 1) return 'must not end with a backslash';
      index++;
    } else if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '(') open.push(char === '[' ? ']' : ')');
    else if (char === ']' || char === ')') {
      if (open.pop() !== char) return 'must close each bracket and parenthesis in order';
    }
  }
  if (quote) return 'must close each quote';
  if (open.length) return 'must close each bracket and parenthesis in order';
  return null;
}

export function hideStyle(selectors) {
  if (!Array.isArray(selectors) || !selectors.length) return '';
  for (const selector of selectors) if (hideSelectorProblem(selector)) throw new Error('Invalid hide selector.');
  return selectors.map(selector => `${selector} { visibility: hidden !important; }`).join('\n');
}
