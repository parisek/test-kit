// Sample project contract: the consent bar renders and offers refusal on its first layer (#380).
// Copy this file into the behavior `source` directory of a project and set the constants below.
// It is trusted project code (src/behavior/README.md). test-kit does not run it unless the project selects it.
// It is a copy that the project owns (R13.41, R13.43). It is not the versioned `cookieconsent` pack of R13.42, and it detects no library version.
//
// The defaults fit the markup of CookieConsent v3 (`#cc-main`). Check them against the page of your project:
// test-kit did not verify them against a release of that library.

// Copy the file and change DEFAULTS, or import createConsentBar from a copy and pass your own options.
export const DEFAULTS = Object.freeze({
  // The contract name. Contract names in a project are unique: give each extra instance its own name.
  name: 'consent-bar',
  // The element of the bar that has a box of its own. A wrapper without a box (for example `#cc-main`) reads as not visible.
  bar: '#cc-main .cm',
  // The refusal variants of the first layer. The first one that is visible counts. Set a variant to null to leave it out.
  // control: a visible reject control. sentence: a visible sentence that tells how to refuse (a regular expression).
  // inDescription: a refusal control inside the description, for example a link.
  refusal: Object.freeze({ control: '[data-role="necessary"]', sentence: null, inDescription: null }),
  // Click the refusal and check the stored choice. Use it on a local side only: the click changes the state of the page.
  clickRefusal: false,
  // The cookie that stores the choice, and the categories that a refusal may keep.
  choiceCookie: 'cc_cookie',
  necessary: Object.freeze(['necessary']),
  timeoutMs: 5000,
});

async function visible(locator) {
  try { return await locator.first().isVisible(); } catch { return false; }
}

async function refusalVariant(bar, refusal) {
  if (refusal.control && await visible(bar.locator(refusal.control))) return 'control';
  if (refusal.sentence && await visible(bar.getByText(new RegExp(refusal.sentence, 'i')))) return 'sentence';
  if (refusal.inDescription && await visible(bar.locator(refusal.inDescription))) return 'in-description';
  return null;
}

function categoriesOf(cookies, name) {
  const cookie = cookies.find(item => item.name === name);
  if (!cookie) return null;
  try {
    const value = JSON.parse(decodeURIComponent(cookie.value));
    return Array.isArray(value?.categories) ? [...value.categories].sort() : null;
  } catch { return null; }
}

export function createConsentBar(options = {}) {
  const o = { ...DEFAULTS, ...options, refusal: { ...DEFAULTS.refusal, ...(options.refusal ?? {}) } };
  return {
    name: o.name,
    // One instance for each page. A page without a bar must fail, not skip, so detect always returns the bar locator.
    detect: async page => [page.locator(o.bar).first()],
    async run(page, bar) {
      try { await bar.waitFor({ state: 'visible', timeout: o.timeoutMs }); } catch {
        const webdriver = await page.evaluate(() => navigator.webdriver === true).catch(() => false);
        throw new Error(`The consent bar ${o.bar} has no visible box.${webdriver ? ' The browser reports navigator.webdriver. A bar library that hides from bots shows no bar to an automated browser.' : ''}`);
      }
      const refusal = await refusalVariant(bar, o.refusal);
      if (!refusal) throw new Error('The first layer of the consent bar offers no visible refusal.');
      if (!o.clickRefusal) return { rendered: true, refusal };
      if (refusal !== 'control') throw new Error('clickRefusal needs the reject control variant.');
      await bar.locator(o.refusal.control).first().click();
      try { await bar.waitFor({ state: 'hidden', timeout: o.timeoutMs }); } catch { throw new Error('The consent bar stays visible after the refusal.'); }
      const categories = categoriesOf(await page.context().cookies(), o.choiceCookie);
      if (!categories) throw new Error(`The refusal stored no readable ${o.choiceCookie} cookie.`);
      const extra = categories.filter(name => !o.necessary.includes(name));
      if (extra.length) throw new Error(`The refusal stored more than the necessary categories: ${extra.join(', ')}.`);
      return { rendered: true, refusal, categories };
    },
  };
}

export const consentBar = createConsentBar();
