# Static export

`exportReport` writes a portable viewer and its allowed evidence (R10.11).
`exportHistory` writes relative links to report viewers and standalone feedback.
Both commands require a new output directory. They start no server.
The in-place refresh of a publish directory is a separate mode (R10.12, R10.13, ADR 0005). It is not written yet, except the pure index writer below.

`src/server/files.js` owns the shared allowed-file index. Export gives each
untrusted evidence file a generated safe name. HTML evidence uses text names.
Report and comparison sidecar references map to those names. Source files stay
unchanged. Only the trusted viewer and history shells remain HTML.

The project owns the static host, access control, and retention policy.

`index-file.js` holds `buildPublishIndex(history, { now, unavailableReportIds })`.
It is a pure function (R4.4, R10.13). It takes the result of `scanHistory` and a
clock value, and returns the `index.json` object. It reads no file and writes
none. No command calls it yet; the in-place refresh will (R10.12). The tests
are in `tests/unit/export-index-file.test.js`.
