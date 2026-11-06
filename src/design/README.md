# src/design

A side of supplied images, and the pair that compares it with a captured run. Spec R4.6, R5.5, R8.15.

`import.js` implements `import --side <id>`. `importDesign` reads the images that `target.design` maps under the `root` of a design side and writes an immutable run in the layout of a capture. It opens no browser. The provider `files` opens no network connection. The provider `figma` does, only during `import` (R5.5). `readDesignFile` resolves one path against the real root, refuses an escape (a `..`, an absolute path, a symlink that leaves the root), and reads a regular PNG file of at most 40 MiB. Every check runs before a run directory exists, so a failed import leaves no run.

`paths.js` is pure. `designPathProblem` and `designRootProblem` give the reason a configured path is refused, or null. The configuration check (`src/config/normalize.js`) and the import use them.

`png.js` is pure. `readPngSize` reads the size from the header. `expectedWidth` and `widthProblem` give the width rule of R8.15 and the diagnostic that names both sizes. `designProvenance` builds the record of one image: `{ provider, source, importedAt, sha256, width, height }`.

`compare.js` is pure. `isDesignRun` reads the stored side kind. `designPairProblem` gives the reason a cell of a pair with a design run is `incompatible`, or null. `src/compare/runs.js` calls it. It skips the browser settings, tool and scope checks for such a pair.

A viewport with no mapped file has no capture entry, so a pair reads it as `missing` (R8.7), never `match`. A design image never gets cropped or resized.

`figma-ids.js` is pure. It checks the file key, the node ID, the token form and the image URL (https, no credentials, no port, a Figma image host), and gives the export scale of a viewport.

`figma.js` is the only file here that uses the network. `readToken` reads `FIGMA_TOKEN` from the environment and fails before any request. `downloadFigmaImages` asks the Figma API for the images (one call for each batch of node IDs and each scale), then downloads each returned URL. The token goes to the API only. It follows no redirect, retries nothing, bounds time and bytes, and puts no URL or token in an error. `apiBase`, `fetchImpl`, `imageUrlProblem` and the timeouts are hooks for tests: no option or key sets them.

Not built: a `design` key that a target generator reads from a component definition (`import` refuses `targetSource`). It stays open on issue #288.
