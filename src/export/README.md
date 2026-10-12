# Static export

`exportReport` writes a portable viewer and its allowed evidence (R10.11).
`exportHistory` writes relative links to report viewers and standalone feedback.
Both commands require a new output directory. They start no server.

`src/server/files.js` owns the shared allowed-file index. Export gives each
untrusted evidence file a generated safe name. HTML evidence uses text names.
Report and comparison sidecar references map to those names. Source files stay
unchanged. Only the trusted viewer and history shells remain HTML.

The project owns the static host, access control, and retention policy.
