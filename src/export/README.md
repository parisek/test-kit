# Static export

`exportReport` writes a portable viewer and its allowed evidence (R10.11).
`exportHistory` writes relative links to report viewers and standalone feedback.
Both commands require a new output directory. They start no server.
`history --publish DIR` is a separate mode (R10.12, R10.13, ADR 0005). It refreshes one stable directory in place with `publish.js`.

`src/server/files.js` owns the shared allowed-file index. Export gives each
untrusted evidence file a generated safe name. HTML evidence uses text names.
Report and comparison sidecar references map to those names. Source files stay
unchanged. Only the trusted viewer and history shells remain HTML.

The project owns the static host, access control, and retention policy.

`index-file.js` holds `buildPublishIndex(history, { now, unavailableReportIds })`.
It is a pure function (R4.4, R10.13). It takes the result of `scanHistory` and a
clock value, and returns the `index.json` object. It reads no file and writes
none. `publish.js` calls it. The tests are in `tests/unit/export-index-file.test.js`.

`publish.js` holds `publishHistory({ local, dir, now, cwd, home, fs })` and the
pure `recoveryAction(state, paths)`. `publishHistory` runs the nine preflight
checks in the order of R10.12, takes the lock with an exclusive `mkdir`, builds
the stage, swaps it with `DIR` (steps S1 to S6) and returns the warnings and the
stderr lines. It copies a report with `writeReportEvidence` from `report.js`, the
same evidence rewrite as `report --export`. The `fs` option replaces single
`node:fs/promises` functions; tests use it to inject failures. The tests are in
`tests/unit/export-publish.test.js`.
