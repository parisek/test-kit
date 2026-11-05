# src/config

Reads the global configuration, checks it, and copies the settings used into each run. Spec section 5.

`normalizeConfig(input)` validates JSON data and returns a frozen copy.
`loadConfig(path)` reads JSON and returns the config and absolute runtime paths.
Runtime paths resolve from the configuration directory.

`captureSettings(config, sideId)` selects effective screenshot settings.
`settingsHash(settings)` hashes canonical JSON with sorted object keys.
Neither function reads the filesystem. The hash excludes input origins and paths.

Version 0.1 starts with explicit local origins, list targets, and screenshots.
Current development also accepts opt-in HTML, status, evidenced rules, and
pair-scoped known differences. It rejects unsupported checks and unknown keys.
Rules and known differences do not enter screenshot capture settings hashes.
Viewport dimensions range from 1 to 4096. Device scale factors range from 0.5
to 3. A viewport cannot exceed 32 million physical pixels. Capture must also
bound the final full-page image. The extra settle wait is at most 10 seconds.
The screenshot timeout is at most 120 seconds.

`packs` is an optional list of built-in pack IDs (`a11y`, `lint`, `swiper`; R13.44).
An absent key means no packs (G3, R5.1). The list takes IDs only, no options.
An unknown ID, a duplicate or a non-ID entry fails validation.
The check reads the static list in `src/packs/ids.js` and imports no pack.
The selection does not enter the capture settings hash.
`src/packs/builtin.js` maps the IDs to pack objects for `resolveChecks`.

`targetSource` is an optional object that reads component targets from a styleguide (R13.3).
It holds `source` (`"styleguide"` only), `side` (a local side), `mount` (an origin-relative path, default `/styleguide`) `include` (a list of target IDs; a component ID also selects its variants), and the opt-in booleans `variants` and `pages` (R13.52).
When it is set, `targets` must be absent or empty.
Validation is pure: it reads no network and imports no styleguide code (R4.4, R13.4).
Capture reads the catalogue and writes the resolved list into the run settings (`src/styleguide/README.md`).
An absent key changes nothing, and the key does not enter the capture settings hash.

A side with `kind: "design"` is a design side (R5.5): `{ kind, provider: "files", root }`, with no origin. A target may set `design`, a map from a viewport ID to a PNG path under `root`. Validation is pure and refuses an absolute path, a `..` segment, a name that is not a plain `.png` path and an unknown viewport. `designSettings` gives the settings a design run hashes (the provider and the viewports). A configuration without a design side changes nothing.
