# Report viewer

One shell, several views, one `report.json`. Plain files: ES modules, CSS layers, no bundler, no dependencies.
It is the evolution of upstream `report-viewer.html`: the shell stays, the data gains a version, the views multiply.

```
python3 -m http.server 8080      # fetch() and modules need a file server
open http://localhost:8080/?data=data/report.v1.json#matice
npm test                          # node --test, pure logic only (no DOM)
```

`?data=<url>` picks the report. `#cile`, `#matice`, `#nalezy` pick the view. The pair kind in the pair bar picks a default view.

## Layout

```
index.html            shell: rail, view switch, pair bar, note, view slot, about slot
css/
  tokens.css          colour and size tokens, light + dark (:root[data-theme])
  base.css            reset, focus, reduced motion
  shell.css           the frame: rail, view switch, note, state boxes
  components.css      one section per component
  views.css           one section per view
js/
  app.js              boot, redraw loop, keyboard, focus and scroll kept across redraws
  data.js             loadReport, adaptReport (v1 and v2), validate, ReportError
  adapt-v1.js         report.json written by build-report.js today -> the v2 model, nothing dropped
  state.js            createStore, initialState (the whole state shape is documented there)
  actions.js          every state change; views never write state
  classify.js         PURE: match | explained | unexplained | oracle, summaries, cause scopes
  pairs.js            the kinds of pair and the default view of each
  router.js           #view token
  dom.js              h(), mount(), clear(): text only, report data never becomes markup
  views/              index.js (registry) + targets, matrix, findings, timeline
  components/         pair-bar, rail, stage, diff, steps, composed, about
  rules.js            PURE: scoped normaliser rules (normalizeRules, ruleApplies, rulesFor)
  labels.js           groupLabel(report, key)
data/                 report.json (pages, v2 sample), report.components.json (components), report.v1.json (shape of today)
css/steps.css         steps, scoped rules and composition chips (index.html must link it after components.css)
tests/                node:test for classify, data, actions, router, pairs
```

Layers are declared once in `index.html`: `tokens, base, shell, components, views`. A later layer wins, so a view never
needs `!important` against a component.

## The report (schemaVersion 2)

Additive over version 1. A report without `schemaVersion` is version 1 and is adapted, not rejected.

```
schemaVersion  2
meta           project, title, generated, matchBelow (percent), primaryViewport, viewports[{id,label,width,height}], note,
               groups?  { key: 'Label' }   names for `entries[].group` (basic, parts, blocks ...); cs, en, de are built in
               sample?  true               every number in the file is an example
runs[]         id, side, label, at, captures                      named runs; they live under tests/visual/runs/, never in git
pair           kind, aRunId, bRunId
entries[]      id, kind ('page' | 'component' | ...), title, path, group, judge?, note?
  composedOf?  [entry ids]   a page lists its components; the viewer shows "Složeno z" and, on the component, "Použito na"
  viewports[]  id, label, ratio, dh?, error?, artifacts.screenshot{ a{src}, b{src}, diff{ratio, regions[], regionsUnit} }
  artifacts    html{rows[]}, status{rows[]}, behavior{note, rows[], verdict?, steps[]?, recordings[]?}   per target
  sample?      { layout }   dev only: the stage draws a wireframe when a viewport has no screenshot src
causes[]       id, title, detail, known
findings[]     id, targetId, viewportId?, artifact, causeId       viewportId absent = every viewport
rules          { ruleId: 'text' | { text, evidence?, applies? } }
```

### Rules are scoped to the situation

A string rule applies everywhere (version 1 habit). An object rule narrows with `applies`; every list that is present
must contain the current value, a missing list means "no limit on that axis":

```
applies: { pairs?: [pair kind ids], artifacts?: ['html'|'status'|'behavior'|'screenshot'], kinds?: ['page'|'component'], targets?: [entry ids] }
```

`rulesFor(report, target, pairKind, artifact)` in `js/rules.js` returns `used` (the rule fired on this target, through the
`noise` or `known` key of its rows, and is in scope) and `others` (in scope, did not fire). The HTML tab shows `used` and a
collapsed "Další pravidla v tomto kontextu (N)". A rule outside its scope is in neither list, and a row that names such a
rule is **not** hidden by normalisation: outside its scope the row is a real difference. `validate()` refuses a scope that
names an unknown pair kind or artifact.

### Behaviour steps and recordings

`artifacts.behavior` keeps `rows`, `note`, `verdict`. It may add:

```
steps[]       { id, title, status: 'same'|'changed'|'failed', causeId?, a?{text}, b?{text},
                evidence[]: { kind: 'screenshot'|'console'|'network'|'datalayer'|'dom', side: 'a'|'b', label, src?, text? } }
recordings[]  { kind: 'trace'|'video', side: 'a'|'b', label, path }      path under tests/visual/runs/, local, never in git
```

The viewer shows the steps as a numbered procedure (a procedure is a sequence), the outcome on each side, and a filmstrip of
the evidence: a screenshot as an image when it has `src`, otherwise a labelled placeholder. For a trace it shows the command
`npx playwright show-trace <path>` with a copy button; for a video, a plain link.

#### How behaviour is recorded (Jak se chování zaznamenává)

The runner that writes the report does the recording; the viewer only reads it.

- Playwright runs with `trace: 'on'` and `video: 'on'`, one page per test, one context per side.
- Each `test.step(title, ...)` ends with a `page.screenshot()`, and its path goes into that step's `evidence`.
- Hooks collect what a screenshot cannot show: `page.on('console')`, `page.on('request')` and a patched
  `window.dataLayer.push`. Their output becomes `console`, `network` and `datalayer` evidence with `text`.
- Outcomes of the two sides are compared per step: equal text is `same`, a different outcome is `changed`, a thrown error
  is `failed`. A finding on the `behavior` artifact then ties the step to a cause.
- The runner writes `report.json`. Screenshots, traces and videos stay under `tests/visual/runs/<id>/`, which `.gitignore`
  already covers. Nothing a run produces goes into git.

### Pages and components use the same viewer

A component report is a report like a page report: entries of kind `component` grouped by `meta.groups`, the same viewports,
the same classes, the same findings. Pages list their components in `composedOf`, so a change on a component is one click from
every page that uses it. Open `/?data=data/report.components.json` for the component sample. The styleguide can feed the same
file shape from its own renders.

## Contracts

A view module (`js/views/*.js`, registered in `views/index.js`):

```js
export default { id, label, enabled, reason?, rail(ctx) -> Node, main(ctx) -> Node, keys?(ctx, event) -> boolean }
// ctx = { state, report, actions, known, summary }
```

Components (`js/components/*.js`) are functions of `ctx` and plain arguments that return a Node:

| Module | Exports |
| --- | --- |
| `pair-bar.js` | `pairBar(ctx)` pair select, side names, "výchozí pohled" pill, summary tiles |
| `rail.js` | `filterChips(ctx)`, `targetList(ctx)`, `causeList(ctx)` |
| `stage.js` | `stage({ report, target, viewportId, side: 'a' \| 'b', regions? })` `<img>` of the screenshot, else the wireframe, else "Bez snímku" |
| `diff.js` | `htmlDiff(ctx, target)`, `statusTable(target)`, `behaviorPanel(target, ctx?)` |
| `steps.js` | `stepsPanel(target, ctx?)`, `traceCommand(path)`: the recorded procedure of a behaviour test |
| `composed.js` | `composedRows(ctx, target)`: "Složeno z" and "Použito na" chips |
| `about.js` | `aboutPanel(ctx)` |

Rules for all of them: build nodes with `h()` (no `innerHTML`); give any control that must keep focus across a redraw
`data-focus="<unique key>"`; read colour from tokens; one section per component in `components.css`.

## Add a view

1. `js/views/<name>.js` with the default export above. Add its id to `VIEW_IDS` in `pairs.js`.
2. Register it in `views/index.js`.
3. Read data through `classify.js`; add a test there if you need a new derivation. Do not store derived values.
4. Styles in `views.css`, inside `@layer views`.

## What is not built yet

- **Timeline view.** It needs immutable named runs and stored comparison records. Upstream overwrites PNGs by stable name
  today. The view is registered and disabled with its reason.
- **Real screenshots and recordings.** `stage.js` and `steps.js` already prefer `src` and `path`; the samples have none for
  screenshots and draw wireframes or placeholders. No runner writes `steps[]` yet; the shape above is the contract for it.
- **Writing `known_diffs`.** The Nálezy view only shows what would be written. The write is a command, not this window.
- **Rule authoring.** Scopes are written by hand in the report. A rule catalogue that lives in the project's manifest, with
  the evidence per rule, is the next step.
- **Imports from upstream.** In `tests/visual/` this app would reuse `lib/viewports.js`, `lib/runs-store.js` and
  `lib/diff-regions.js` instead of the small stand-ins here (`meta.viewports`, `runs`, `diff.regions`).
- **Locales.** UI text is Czech, as upstream `report-viewer.html` is. A `locales/cs.json` is a later step.
- **A package.** A later package, like parisek/styleguide, is the long-term home; not now.

The 3 % threshold is a compass, not a verdict for every pair. `matchBelow` is per report for that reason.
