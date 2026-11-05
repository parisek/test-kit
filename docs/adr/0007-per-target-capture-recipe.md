# ADR 0007: How `run.json` records a per-target capture recipe

Status: proposed. The owner decides. The agent does not merge this record. No code or specification change comes with it.
Requirements: R5.1, R5.4, R8.7, R8.9, R12.4. Tracked in #49. The decision gates #50, #51, #52, #53 and #54 (parent #45), and #294 (`settle.pin`).

## Context

#49 lists slices of the legacy visual capture recipes that the package must preserve: a selector union, content-box crop, per-target settlement, lazy-image settlement, narrow reveal operations, and keep-existing and retry behavior for the reference side. Each slice adds a way to change what one target captures. Each needs a record in `run.json`, so a later comparison can tell whether two captures are comparable.

The owner's comment on #45 (2026-11-05) states the problem: one target override must not make every target incomparable (R8.9). The owner's decision of the same date asks for this record, with options. The owner decides. The code follows.

What the code does today (read on `main`, 2026-11-05):

- `captureSettings()` hashes `viewports`, the side `settle` and `screenshot` (`src/config/settings.js`). The run adds `browser` and, for behavior, the contract fingerprint. This is `run.json` `settingsHash`. It excludes target selectors. #49 states this as its provenance prerequisite.
- Each entry of `captures[]` already carries two hashes. `settleHash` is the hash of the effective settle recipe (`settleRecipe`: side, then `target.settle`, then `target.settleBySide[side]`). `scopeHash` is the hash of `{ selector, box }` (`screenshotScope`). Issues #68 and #76 added them.
- `comparisonState` (`src/compare/runs.js`) compares per capture. It returns `incompatible` when the run hashes or tools differ, or when the scope or settle recipe of the two captures differs. A target compares on its own. This is close to the owner's proposal on #45.
- An entry with no `scopeHash` stands for the default scope (border box, no array). An entry with no `settleHash` stands for no target settle, no reveal and no lazy images. This keeps old runs readable (`scopeMatches`, `settlementMatches`).
- The whole normalized config is stored as `run.json` `settings`. `settings.targets` holds the declared `selector`, `box`, `settle` and `settleBySide`.
- `comparisonState` returns only the state. It does not name which part differs.

The gap is smaller than the issue text suggests, but it is real:

1. A hash is not readable. R5.4 says the report must show the recipe. A hash alone shows nothing.
2. A declaration does not prove the effect. The same declared selector union can produce a different crop after a change in the geometry code (outward rounding, coordinate conversion, clip mode). A hash of the declaration cannot see that change. #49 asks for "capture-mode and version evidence".
3. The effective recipe has no single home. Slices 2 to 5 and #294 add keys (`box`, `lazyImages`, `reveal`, `pin`). Without a rule, each slice invents its own place.
4. The incompatible diagnostic names no part.

## Constraints

- `run.json` is frozen for 1.x (`docs/seam.md`, stored run, `schemaVersion` 2). A new optional key is an addition. A changed meaning is a break. A new required key is a break. Readers of old runs must keep working.
- A pair is comparable only when `settingsHash` and the tool versions are equal (R8.9). The global hash must not change for a run that uses no recipe.
- One target override must not change the verdict of another target.
- Nothing new runs by default (R5.1). A project with no recipe key records no new data that changes behavior.
- Pure logic stays pure (R4.4). Classification of recipes has no DOM and no file system.
- The repository is public. No client data (R12.4). Examples use `example-site`.
- Stored data is untrusted. A reader validates the recipe before it uses it.

## Options

All options record a mode version. A mode version is an integer that the package raises when a change to the capture code alters the pixels for the same declaration. Two captures with different versions are `incompatible`. Without it, a hash of the declaration proves nothing about the effect.

### Option A: an effective recipe object in each `captures[]` entry

Shape. Each capture entry gets one optional key `recipe`. It holds the effective recipe of that target on that side, after merge and defaults:

```json
{ "targetId": "home", "viewportId": "desktop", "state": "captured", "settleHash": "sha256:...", "scopeHash": "sha256:...",
  "recipe": { "version": 1,
    "scope": { "selector": ["#hero", "#intro"], "box": "border" },
    "settle": { "waitMs": 0, "disableMotion": true, "lazyImages": true, "reveal": [] } } }
```

`recipe.scope` and `recipe.settle` are the same values that `screenshotScope` and `settleRecipe` return today. Later slices add keys inside them (`pin`, a reveal step type). `settleHash` and `scopeHash` stay. They stay equal to the hashes of `recipe.scope` and `recipe.settle`. A reader may check this.

Hash effect. None on the run `settingsHash`. The recipe lives in the capture entry, outside the global hash. A capture compares only to its counterpart with an equal recipe.

Incompatible pairs. The comparison of one capture pair returns `incompatible` for that pair. Other pairs keep their own state. The diagnostic names the part that differs: `scope`, `settle` or `version`, with the two values shown from the stored recipes.

Migration. An entry with no `recipe` reads as the default recipe (border box, no target settle), the same rule as `scopeMatches` and `settlementMatches` use today. A new run with no recipe key writes `recipe` with the default values, or omits it (open question 3). Legacy `tailwind-base` recipes (see "Migration of the legacy recipes") map to config keys, and the capture writes the effective result.

Risks. The key adds data to each entry: about the size of the settle object, repeated for each viewport (estimate, not measured). Two stored copies (declaration in `settings.targets`, effective value in the entry) can disagree in a hand-edited file. A reader must treat the entry as the evidence and the config as the declaration. A new slice must put its keys inside `recipe` and must raise `version` when pixels change.

### Option B: a recipes map in `captureSettings`, keyed by target id

Shape. `run.json` `captureSettings` gets an optional `recipes` object: target id to effective recipe, written once for the run.

```json
"captureSettings": { "viewports": [], "settle": {}, "screenshot": {}, "browser": {}, "recipes": { "home": { "version": 1, "scope": {}, "settle": {} } } }
```

Hash effect. A choice with two bad ends. If `recipes` enters `settingsHash`, one override changes the global hash and every target becomes incomparable. That is exactly what the owner wants to avoid. If `recipes` stays outside the hash, `captureSettings` holds a key that the hash does not cover, and `captureSettings` stops being the hashed object. Today the browser block and the behavior fingerprint sit inside it and inside the hash. A key that is present but excluded breaks that rule. `userAgent` and `challenge` are excluded, but they live in `settings`, not in `captureSettings` (R3.4, R3.5).

Incompatible pairs. The compare step looks up both maps by target id. Same result as option A per target. One lookup per target instead of per capture.

Migration. A run with no `recipes` key reads as all defaults. The map is written once, so the size is smaller than option A.

Risks. A map by target id repeats nothing for viewports, but one recipe cannot differ between viewports of the same target. Slices 3 and 4 do not need that today. A later need (a reveal only on mobile) would force a second change. The excluded-key problem above is a trap for the next reader.

### Option C: a recipe id that points to a recipes file

Shape. A project keeps named recipes in a file (for example `tests/visual/recipes.json`). A target selects one with `recipe: "hero-union"`. `run.json` records the id and a content hash of the recipe, not the recipe:

```json
{ "targetId": "home", "recipe": { "id": "hero-union", "hash": "sha256:...", "version": 1 } }
```

Hash effect. None on the run hash. The capture entry holds the id and the hash.

Incompatible pairs. Equal hash and equal version make a pair comparable. A different id with an equal hash is comparable. The diagnostic can show the ids and the two hashes, not the content, unless the run also copies the file.

Migration. The legacy recipes become entries of the file with little rewriting. This is the nearest fit for a project that already has a recipe per page type. It adds a new config key and a new file format, so it needs its own schema, loader and bounds.

Risks. It adds a new input file and a new path to validate (R13.11 and the "plain relative path" rule apply). Without a copy of the content in the run, the run alone cannot show the recipe, and R5.4 fails for an old run whose file changed. With a copy, this option becomes option A plus a name. It is the largest change to the frozen config (`targets[]` gains a key, `recipes` gains a file format). It is the most work for a gain that few projects need before 1.2.

### Option D: keep the hashes, add a readable diagnostic only

Shape. No new key in `run.json`. `settleHash` and `scopeHash` stay. The compare step reads the declarations from `run.settings.targets` and names the differing part in the diagnostic. A new slice adds config keys and extends `screenshotScope` or `settleRecipe`. A mode version enters the hashed objects (for example `scope.version`).

Hash effect. None on the run hash. A new key inside `screenshotScope` or `settleRecipe` changes the per-capture hash only for a target that uses it. A version bump in the hashed object changes the hash of every capture. Then every old capture reads `incompatible` against a new one. That makes every target incomparable after a version bump, the outcome the owner wants to avoid.

Incompatible pairs. Per target, as today. The diagnostic names `scope` or `settle` and shows the declarations from `settings.targets`.

Migration. Nothing to migrate. Old runs already work.

Risks. The evidence is the hash plus a declaration that lives in a different object. The effective recipe has no stored form, so a change of a default in a later release changes what "default" means for old runs. Slices 4 and 5 need an effective value (lazy images, reveal after merge), so slice 3 would add this record anyway. The version problem in the Context (point 2) stays open.

## Comparison

| Need | A: in capture entry | B: map in settings | C: id and file | D: hashes only |
| --- | --- | --- | --- | --- |
| Frozen `run.json` (addition only) | yes | yes, with an excluded key | yes | yes |
| Run hash unchanged | yes | only if the key is excluded | yes | yes |
| One override affects one target | yes | yes | yes | yes, until a version bump |
| Per viewport recipe possible | yes | no | no | no |
| Report can show the recipe (R5.4) | yes | yes | only with a copy | from declarations |
| Detects a change of capture code | yes (`version`) | yes (`version`) | yes (`version`) | no |
| New config surface | none | none | file and key | none |
| Old runs readable | default rule | default rule | default rule | unchanged |

## Migration of the legacy recipes

The issue text names the legacy surfaces. It does not give the `tailwind-base` file format. This record does not guess it. The mapping below uses only the names in #49.

| Legacy surface in #49 | Slice | Config today | Recorded in the recipe |
| --- | --- | --- | --- |
| A selector union with border box | 1 | `target.selector` as a list | `scope.selector` (list) |
| A content-box crop | 2 | `target.box: "content"` | `scope.box` |
| Per-target settlement over side defaults | 3 | `target.settle`, `target.settleBySide` | `settle` (merged) |
| Lazy-image settlement, full-page and overlay parity | 4 | `settle.lazyImages` | `settle.lazyImages` |
| Reveal operations | 5 | `settle.reveal` | `settle.reveal` |
| Pinned header or footer (#294) | after 3 and 4 | none | `settle.pin` |
| Reference keep-existing and transient retries | 6 | none | not part of the recipe: orchestration, not pixels |

Slice 6 stays out of the recipe. A retry or a keep-existing decision changes which run exists, not how a capture is made. Recording it, if wanted, is a separate question (open question 6).

A project with a legacy setup moves in this order: copy the declared values into `targets[]` keys, run `capture`, and read the recipe from the first run. A run made before the move has no recipe. It reads as the default recipe. A pair of an old run and a new run with a non-default recipe is `incompatible` for that target only. This matches the migration guide (`docs/migration-guide-tailwind-base.md`, part 1), which already treats an old run as comparable only when settings match.

## Recommendation

Option A, with these rules:

1. The recipe lives in each capture entry as the optional key `recipe` (`version`, `scope`, `settle`). New slices add keys inside it. They never add a sibling key.
2. `settleHash` and `scopeHash` stay. They are the hashes of `recipe.settle` and `recipe.scope`. The compare step keeps using them, and reads the recipe only to name the difference.
3. The run `settingsHash` does not change. The global hash keeps covering `viewports`, side `settle`, `screenshot`, `browser` and the behavior fingerprint.
4. `recipe.version` is an integer owned by the package. A change that alters pixels for the same declaration raises it. A mismatch reads `incompatible` for that capture pair only.
5. A missing `recipe` means the default recipe. The existing rule for `scopeHash` and `settleHash` extends to it.

Why A and not the others. It is the only option that gives a readable record, a version, a per-viewport value and no change to the global hash, with no new config surface. B has no real advantage and a trap with the hash. C fits few projects and adds a file format to a frozen seam. D keeps the version problem, and slice 4 forces the record anyway. A is nearest to the owner's proposal on #45 ("record the effective capture mode for each target in its manifest entry"). The difference is a stored value in place of a hash, plus a version.

Not measured: the size of `recipe` in a real run, and the effect on `run.json` write time. Both are estimates until a slice ships.

## Requirement text this record would add

This record does not change the specification. If the owner accepts option A, the first slice adds this text (numbers are tentative):

- R5.5 Each capture entry of a run may carry `recipe`: `{ version, scope, settle }`. `scope` holds the effective `selector` and `box`. `settle` holds the effective settle recipe after the merge of the side, `target.settle` and `target.settleBySide` (R5.4). `version` is an integer that the package raises when a change of capture code alters the pixels for an unchanged declaration. The recipe must not enter the run `settingsHash`. An entry with no `recipe` reads as the default recipe.
- R8.15 Two captures of one target compare only when their `recipe` values are equal. A pair of captures that differ in `scope`, `settle` or `version` has the state `incompatible` (R8.7, R8.9). The diagnostic names the differing part and shows both stored values. This state does not change the state of another target.

## Consequences

If the owner accepts option A:

- `run.json` gains one optional key. `schemaVersion` stays 2. `docs/seam.md` gets a row: stored run, `captures[].recipe`, frozen as an addition.
- #49 slices 1 to 5, #294 and the siblings #50 to #54 write their keys inside `recipe` and cite this record.
- Slice 1 writes `recipe` with `scope.selector` as a list. Its tests must fail without the change (a run with a union records the list, an A/A pair is `complete`, a pair with a different union is `incompatible` for that target only).
- The viewer and `summary` read the recipe to show the differing part. That work needs `PRODUCT.md`, `DESIGN.md` and `docs/viewer-workflow.md`, and follows them.

If the owner rejects it, #49 and its siblings stay blocked until the owner names another option.

## Open questions for the owner

1. Which option: A (recommended), B, C or D?
2. May a mode version (`recipe.version`) exist at all, or must compatibility stay a pure function of declarations? Without it, a code change that moves pixels reads as a match.
3. Does a run with no recipe key write `recipe` with default values, or omit it? Writing it gives a uniform record. Omitting it keeps new and old runs equal in shape.
4. Where does the version number live: one for the whole capture engine, or one for each mode (selector union, content box, lazy images, reveal)? One number is simple. Several numbers make a change in one mode leave the others comparable.
5. When two captures differ only in `version`, is that `incompatible` (recommended) or a distinct state that the viewer shows as "recapture"?
6. Does the record keep retries and keep-existing decisions (slice 6) out of the recipe? Do you want them recorded in some other place?
7. May a recipe differ between viewports of the same target? Option A allows it. Options B and C do not.
8. Does #294 (`settle.pin`) belong in this record's scope, or does it follow as its own ADR after slices 3 and 4?
