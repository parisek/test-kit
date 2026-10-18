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

`runAxe` options: `tags` (a list of axe rule tags; the default is the axe default rule set), `timeoutMs` (a finite number from 1 to 2147483647; the default is 30000), `axePath` (path to `axe.min.js`). A bad option gives a `failed` artifact. It never throws.
`runAxe` checks each tag with `axe.getRules`. A tag that matches no rule gives `failed`.
The runner checks the top document. It does not inject axe into frames of other origins.

Limits of the runner:

- Every step of `runAxe` that touches the page runs inside the timer, so a busy page cannot hang the caller.
- `runAxe` claims the page with one atomic step and releases it only if it claimed it. Two runs at once on one page: one runs and the other returns `failed`.
- After a timeout, axe may still run on the page. Do not reuse that page. A second run on it returns `failed` with the message "An earlier axe run on this page did not finish. Use a new page."
- Axe runs inside the page. A hostile page can lock or replace `window.axe` and fake a clean result. This is inherent to in-page injection. Run the pack on pages you control.

## Artifact

The artifact is JSON-like data:

- `tool`: `axe-core`.
- `status`: `complete`, `missing` or `failed`.
- With `complete`: `version`, `counts` (`passes`, `violations`, `incomplete`, `inapplicable`: numbers of rules), `violations`, `incomplete` and `omittedNodes`. A rule has `id`, `impact`, `help`, `helpUrl`, `nodeCount`, `omitted` and `nodes` (`selector`, `html`). For a violation rule, `nodeCount` equals the kept nodes plus `omitted`. `omittedNodes` equals the sum of `omitted`.
- With `missing` or `failed`: `reason`.

The reducer keeps at most 500 nodes, 300 characters of HTML and 300 characters of selector. It counts the violation nodes it leaves out in `omittedNodes`. For an incomplete rule it keeps at most 5 nodes and records `nodeCount`. Node text is cut so that its JSON-escaped form stays small (600 characters for review nodes), so one odd node cannot push the evidence over its cap. The caps are chosen safety bounds, not measured numbers.
`helpUrl` is kept only when it is an `https:` URL on `dequeuniversity.com` with no credentials, port or whitespace. It is stored in normalized form (`url.href`). Otherwise it is `null`.
`reduceAxeResults` never throws. A malformed result, more than 200 rules, a rule with no `nodes` list, a target nested deeper than 5 levels, a violation with no usable impact, or a run in which no rule ran gives a `failed` artifact with a reason.
`axeFindings` does not trust a stored artifact. It checks every field again and fails closed. Rule counts must match the stored rules, `nodeCount` must match kept plus omitted nodes, and counts are safe integers up to 1e9.

## Findings

The check `a11y-axe` has basis `absolute` and layer `package`. Each violation node gives one finding. A violation rule with no kept node still gives one finding (empty `selector` and `html`):

| Field | Value |
| --- | --- |
| `layer` | `package` (set by `runChecks`) |
| `message` | `<rule id>: <axe help text>` |
| `severity` | From impact: `minor` is `info`, `moderate` is `warning`, `serious` and `critical` are `error` |
| `evidence` | `ruleId`, `impact`, `selector`, `html`, `nodeCount`, `helpUrl` |

An impact outside this list makes the check `failed`.

An axe `incomplete` rule (axe could not decide) gives one finding for each rule, even a rule with no node:

| Field | Value |
| --- | --- |
| `severity` | `warning` |
| `message` | `<rule id> needs review: <axe help text>` |
| `evidence` | `ruleId`, `needsReview: true`, `impact`, `nodeCount`, `nodes` (up to 5), `helpUrl`. No `state`. |

## States (R8.7)

| Case | Check state |
| --- | --- |
| No artifact | `missing` |
| `status: missing` (for example axe-core is not installed) | `missing` |
| `status: failed` (axe threw, timed out, bad options, or a malformed result) | `failed` |
| No rule ran (all counts zero, or tags match no rule) | `failed` |
| Violation nodes left out by the caps | `complete`. Kept violations stay. One `warning` finding with `truncated: true` and `omittedNodes` says the list is cut. |
| A malformed or tampered artifact, or counts that do not match | `failed` |
| Run complete, with violations or review warnings | `complete`. The findings carry the result. |

Decision, made by the agent and to be ratified by the owner: an axe `incomplete` result does not open the check. Real pages nearly always have incomplete rules. A `missing` check drops all its findings from class aggregation (R8.12), so a real violation next to one undecidable rule would be lost. The review warning keeps the doubt visible and keeps the violations.
The same reasoning applies to cut evidence: the check stays `complete`, the kept violations stay, and one `warning` says the list is cut. A cut list is never a clean page, because the cap leaves at least 500 kept violation nodes.
Consequence to ratify: these warnings have no `evidence.state`. A consumer that gates only on severity `error` reads review items and a cut list as a pass. That is by design. A consumer that wants to gate on them must test `evidence.needsReview` and `evidence.truncated`.

`runAxe` never throws for a bad run. It returns an artifact with `missing` or `failed`.

## Tests

- `tests/unit/a11y-pack.test.js` tests the mapping with fixtures. It needs no browser and no axe-core.
- `tests/integration/check-a11y-runner.mjs` runs axe on `tests/fixtures/a11y/page.html`. It skips when Playwright, Chromium or axe-core is missing.

## Not built yet

Component-level axe contracts, per-state runs (ADR 0004, accessibility per component state), frame injection, and the report `schemaVersion` 3 fields (R13.9).
