# ADR 0008: Pin sticky and fixed elements for a capture

Status: accepted. The owner decided on 2026-11-06 (comment on #294): a matched element gets `position: static !important` for the capture only, at most 20 selectors, recorded in `recipe.settle.pin`. This record follows ADR 0007, decision 8.
Requirements: R5.1, R5.6, R5.8, R5.12, R8.16, R4.4. Tracked in #294 (parent #49). Tier 3 decision, answered by the owner.

## Context

`screenshot.fullPage: true` captures the whole page. Chromium draws a `position: sticky` or `position: fixed` element at the scroll position of the moment. A page that scrolls itself before the screenshot (a restored position, a smooth-scroll library, a lazy-image loader) shows the header again, lower in the image, and the copy covers the content. Two captures of one page then differ, in a full-width band as tall as the header.

#294 measured this on a real site: every difference region was a band of 100 to 155 px at a different y on each side. The same pages compared above the fold were identical.

We reproduced it on Chromium 156 with Playwright 1.64.1. A page that scrolls to y = 1500 before a full-page screenshot shows its sticky header at y = 1500 to 1620 and not at 0. A page that stays at the top shows the header once. The integration check `tests/integration/check-capture-pin.mjs` proves this, so a future Chromium that fixes it is noticed.

A project that sees this noise sets `fullPage: false`. Then the footer is not compared. A fixture that renders the header as `static` cannot help a `remote` side, where only the live HTML is available.

## Decision

1. A settle recipe may set `pin`: a list of at most 20 selectors. Each is a plain string of at most 2048 characters, like a reveal selector. `[]` clears an inherited list.
2. Capture sets `position: static !important` as an inline style on every match of each selector. This happens on the open page, after the reveal and wait steps and before the lazy-image sweep and the screenshot. It changes the page copy in the capture context only. Nothing is written back.
3. `pin` is a settle key. It merges like the others (R5.8): side `settle`, then `target.settle`, then `target.settleBySide[side]`. A later list replaces the inherited list. The effective value is `recipe.settle.pin` (R5.6).
4. A selector with no match fails the capture of that target with a message that names the selector. It saves no screenshot. A reveal step with no match behaves the same.
5. The declaration is fixed. The configuration passes no script and no CSS. The capture sends no request for it, so it works on a `remote` side.
6. `pin` does not change `CAPTURE_ENGINE_VERSION`. The key is opt-in. A change of the key changes the recipe value, and that makes the target `incompatible`. The engine code for a recipe without `pin` is unchanged.

## Alternatives rejected

- Hide the element (`visibility: hidden` or `display: none`). It removes the header from both sides, so a change to the header is no longer visible. It leaves a gap or a layout shift. It stays open as a later option.
- `position: absolute`. It keeps the element out of the flow but anchors it to a containing block that differs between pages. The result depends on the page.
- Mask or crop each tile boundary. Chromium builds the tiles. The capture cannot see the boundary, and masks hide real content.
- Inject a style sheet from the selectors. A selector could close the rule and add CSS. The inline declaration on matched nodes takes no config text as CSS.
- Leave it to the project (static fixtures, `fullPage: false`). It does not work on a `remote` side, and it drops the footer from the comparison.

## Consequences

- A `fixed` header takes no space in the flow. With `static` it takes its height, so the content below it moves down by the header height. Both sides must set the same pin, so both move equally and the pair stays comparable. A pair where only one side pins is `incompatible`.
- A header that JavaScript restyles on scroll keeps its inline `static` value: the inline `!important` wins over a style sheet. A script that writes the inline `position` again can undo it. That case is out of scope.
- A change of `pin` for one target makes only that target `incompatible` (R8.16). Other targets keep their state.
- An element that appears after the pin step, such as a lazy-loaded banner, is not pinned.
- The recipe records the selectors, so the report shows them. No new default behavior (R5.1).
