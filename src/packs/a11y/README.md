# Accessibility pack (axe)

An opt-in pack for the pack API (`src/packs`). It checks one stored `a11y` artifact with the axe-core rules (R7.2, R13.42).
Nothing here runs by default. A project must select the pack (G3, R5.1).
Automated rules find only part of the accessibility problems. This pack does not replace manual testing.

## Parts

| File | Role | Needs |
| --- | --- | --- |
| `axe.js` | Pure. Reduces an axe result to an artifact. Maps an artifact to findings. | Nothing (R4.4) |
| `index.js` | Entry point `@parisek/test-kit/packs/a11y`. Exports `a11yPack`, `reduceAxeResults`, `gapArtifact`. | Nothing |
| `runner.js` | Entry point `@parisek/test-kit/packs/a11y/runner`. Exports `runAxe(page, options)`. | A Playwright page and `axe-core` |

`axe-core` is an optional peer dependency. Install it in the project that uses the runner. The pure files never import it.

## Use

```js
import { resolveChecks, runChecks } from '@parisek/test-kit/packs';
import { a11yPack } from '@parisek/test-kit/packs/a11y';
import { runAxe } from '@parisek/test-kit/packs/a11y/runner';

const artifact = await runAxe(page, { tags: ['wcag2a', 'wcag2aa'] }); // page is already on the URL to check
const plan = resolveChecks({ available: [a11yPack], packs: ['a11y'] });
const result = runChecks(plan, { artifact: 'a11y', value: artifact }, { targetId: 'example-site', viewportId: 'desktop' });
```

`runAxe` options: `tags` (axe rule tags; the default is the axe default rule set), `timeoutMs` (default 30000), `axePath` (path to `axe.min.js`).
The runner checks the top document. It does not inject axe into frames of other origins.

## Artifact

The artifact is JSON-like data:

- `tool`: `axe-core`.
- `status`: `complete`, `missing` or `failed`.
- With `complete`: `version`, `violations`, `incomplete` and `omittedNodes`. A rule has `id`, `impact`, `help`, `helpUrl` and `nodes` (`selector`, `html`).
- With `missing` or `failed`: `reason`.

The reducer keeps at most 500 nodes, 300 characters of HTML and 300 characters of selector. It counts the nodes it leaves out in `omittedNodes`. The caps are chosen safety bounds, not measured numbers.
`helpUrl` is kept only when it is an `https:` URL. Otherwise it is `null`.

## Findings

The check `a11y-axe` has basis `absolute` and layer `package`. Each violation node gives one finding:

| Field | Value |
| --- | --- |
| `layer` | `package` (set by `runChecks`) |
| `message` | `<rule id>: <axe help text>` |
| `severity` | From impact: `minor` is `info`, `moderate` is `warning`, `serious` and `critical` are `error` |
| `evidence` | `ruleId`, `impact`, `selector`, `html`, `helpUrl` |

An impact outside this list makes the check `failed`.

## States (R8.7)

| Case | Check state |
| --- | --- |
| No artifact | `missing` |
| `status: missing` (for example axe-core is not installed) | `missing` |
| `status: failed` (axe threw, timed out, or returned a malformed result) | `failed` |
| An axe `incomplete` result (axe could not decide) | `missing`. The node is an `info` finding with `evidence.state` `incomplete`. |
| Nodes left out by the caps | `missing` |
| A malformed artifact | `failed` |
| Violations found, run complete | `complete`. The findings carry the result. |

`runAxe` never throws for a bad run. It returns an artifact with `missing` or `failed`.

## Tests

- `tests/unit/a11y-pack.test.js` tests the mapping with fixtures. It needs no browser and no axe-core.
- `tests/integration/check-a11y-runner.mjs` runs axe on `tests/fixtures/a11y/page.html`. It skips when Playwright, Chromium or axe-core is missing.

## Not built yet

Component-level axe contracts, per-state runs (ADR 0004, accessibility per component state), frame injection, and the report `schemaVersion` 3 fields (R13.9).
