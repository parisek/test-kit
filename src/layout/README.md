# Layout

The opt-in artifact `layout` holds one structural record for each declared part of a target (R6.14, R6.15, #350).
It runs only when a run selects it with `--artifacts` or the config key `artifacts` (R5.1).
It applies to browser sides and to `claude-design` design sides. A `claude-design` import reads the records in the rendered artboard (R4.6). A `files` or `figma` side has raster images only, so its layout artifact is `missing`.
A part may set `selectorBySide: { <side>: <selector> }`. `partsForSide` gives the selector of one side, else `selector` (#350 part C).

| File | Holds |
| --- | --- |
| `declaration.js` | Pure validation of `targets[].layout` (with `selectorBySide`) and of the top-level `layout` key (R4.4), and `partsForSide`. |
| `record.js` | Pure normalisation: lengths in CSS px (a radius above `MAX_NUMBER`, 1000000, is stored as the bound, and so is a radius token; no other number is bound, #384), colours as `#rrggbb[aa]` (incl. `oklab()` and `oklch()`; no alpha byte of ff), the bounded lowercase text of a colour it does not convert, and the token family rule. |
| `extract.js` | The browser read. It reads computed styles and the custom properties on `:root`, and adds one hidden probe that it removes again. |
| `snapshot.js` | Bounded validation of a stored file. A file outside the bounds is refused as a whole. The refusal names the part, the property and a numeric value, and the diagnostic of the cell carries it. It reads the bound `MAX_NUMBER` from `record.js`, so the writer and the reader share one constant. |
| `compare.js` | Pure comparison per part and property: `match`, `differs`, `missing`, and one `count` difference for a repeat. |
| `compare-artifact.js` | Reads the two stored files, writes the difference sidecar (at most 2 MiB, the cut counted in `differencesOmitted`), and returns the artifact index and the findings. |

Capture stores `layout/<target>/<viewport>.json` beside the screenshot. The read runs after the screenshot, so the probe cannot change its pixels.
A target without `layout` parts stores no `layout` entry, and the run completes without one.

Tolerances: 1 px for a length, 0.01 for a line-height ratio, exact for keywords, colours and font families.
The same token on both sides is a match, also when the values differ. `layout.aliases` maps a token of side A to a token of side B.
Each difference is a relative finding with the check `layout`, with `part` and `property`. No known difference or allowlist entry explains it. A `report-only` decision for the same design value does (R9.14, `src/decisions/`).
A pair with a design run binds the extractor (tool and version), the viewport and the part shape. Its settle recipe, browser settings, entry settings hash and browser version do not decide (R8.15).
The viewer shows nothing new for this artifact. `summary` and `query --artifact layout` show the differences.
