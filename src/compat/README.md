# Legacy compatibility

`planLegacySelection` plans labels for the legacy visual comparison surface.
It supports R4.3 and runs as pure logic under R4.4. It reads no files, starts no
browser, and imports no skeleton helpers. R13.11 still requires callers to keep
shared helpers until all remaining imports move.

Import from `@parisek/test-kit/compat/selection` or the package root.
The input is parsed data:

- `manifest`: entries with `component` and optional `type` (`component` or `page`).
- `harvested`: reference PNG filenames such as `component-button--large.png`.
- `names`: all literal requested names. An empty list selects the full sweep.
- `type`: optional namespace filter (`component` or `page`).
- `noReference`: names to render without references on a full sweep.

The result contains `label`, `kind`, `component`, optional `variant`, and
`renderOnly`. Reference order comes first. Missing requested names follow.
Duplicate names do not create duplicate rows. A bare requested name includes
its harvested variants. A named variant selects that variant only. A missing
requested target produces a render-only row. On a full sweep, `noReference`
adds render-only rows. It does not add rows to a named run. TYPE applies last.
A target declared as a page gets a page prefix when its reference is missing.

Inputs use safe ASCII names of at most 128 characters. Arrays have at most
10000 items. Filenames must have a target prefix and `.png` suffix. Invalid
shapes, paths, control characters, and conflicting target kinds fail explicitly.
The function does not modify input data.

This is selection preparation. It does not replace `visual:harvest`,
`visual:compare`, or `test:visual`. It does not parse YAML, translate capture
recipes, retry captures, or change existing commands. The baseline assertion
ratio `0.002` (0.2%) stays separate from the viewer's `matchBelow` display hint.

The implementation is independently authored. Synthetic tests check the public
contract. Local validation can compare output against an existing skeleton
selector without copying that implementation or project data into this package.

## Harvest plan

Import `planLegacyHarvest` and `legacyHarvestForce` from
`@parisek/test-kit/compat/harvest` or the package root. Pass parsed `manifest`
entries, a `viewports` map, optional `names`, optional `type`, normalized
`force`, and `existing` PNG basenames by viewport. This planner reads no files.

Rows follow manifest order, then viewport order. Each row has a safe filename
and an action: `keep` or `capture`. The result also reports `kept` and `capture`
counts, including an all-kept plan. The caller validates URL and capture recipes
before it uses the plan. It checks `keep` before it creates a browser context.
The caller prints the kept count. A kept reference is not a new measurement.

The FORCE adapter accepts text from the environment. Values `1`, `true`, and
`yes` enable force, without case sensitivity. Other text preserves references.
Whitespace is not removed. The planner accepts a boolean only.

Harvest selects all entries with a literal requested component name. Unlike
compare, `card--wide` does not select the variant of `card`. This retains the
existing command contract. TYPE applies independently. Entry viewports must
name configured viewports. An empty manifest and duplicate writes fail before capture.

This is an independently authored planning seam for R4.3, R4.4 and R13.11.
It does not replace project commands, write references, translate paths,
validate capture recipes, or run retries. Existing aliases stay in place.
