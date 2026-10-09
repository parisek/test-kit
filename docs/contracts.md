# Screenshot contracts for v0.1

Requirements: R4.1, R5.4, R6.1, R6.4, R8.1–R8.9, R9.4, R9.6, R11.6.
This contract covers screenshot capture, comparison, and bounded summary.
Later artifacts keep their specification requirements. They do not run in v0.1.

## Project configuration

The project supplies `test-kit.config.json`. Paths resolve from its directory.
The CLI may accept an explicit config path. The default runs root is
`tests/visual/runs`. Resolve a side origin only from explicit configuration.
In v0.1 target origins must be local. Do not infer the CMS from a directory name.

```json
{
  "schemaVersion": 1,
  "sides": {
    "local": {
      "origin": "http://localhost:8080",
      "settle": {
        "waitMs": 0,
        "selectors": [],
        "disableMotion": true,
        "masks": []
      }
    }
  },
  "targets": [{"id": "home", "kind": "page", "title": "Home", "path": "/"}],
  "viewports": [{"id": "desktop", "width": 1280, "height": 800}],
  "artifacts": ["screenshot"],
  "checks": []
}
```

A target may provide `paths: {sideId: "/different-path"}`. A side path overrides
`path`. Paths must be origin-relative, not absolute URLs or protocol-relative
URLs. Target and viewport IDs must be safe path segments. IDs are unique.
Selectors wait for visible elements. Masks are CSS selectors applied to capture.
`waitMs` is an additional bounded wait after navigation and selectors.
Unknown artifacts and checks fail explicitly. There are no content defaults.

## Stored run

Write `run.json` under the run directory. Write the manifest before capture and
update it after each result. An interrupted manifest retains completed evidence.
The run ID uses the safe run-store grammar. Capture paths are relative to that
run directory and cannot escape it. Never store credentials or browser cookies.

```json
{
  "schemaVersion": 2,
  "id": "baseline",
  "side": "local",
  "label": "Before",
  "at": "2026-10-09T10:00:00Z",
  "state": "complete",
  "settings": {"schemaVersion": 1, "sides": {}, "targets": [], "viewports": []},
  "settingsHash": "sha256:example",
  "tools": [{"name": "playwright", "version": "example", "settingsHash": "sha256:example"}],
  "captures": [
    {"targetId": "home", "viewportId": "desktop", "state": "captured",
     "path": "screenshots/home/desktop.png", "statusCode": 200, "finalPath": "/"}
  ]
}
```

The abbreviated `settings` above stands for the entire normalized configuration
used by this run. Retain target paths, viewport dimensions, and settle settings.
`settingsHash` covers effective Chromium capture settings: viewport dimensions,
settle recipe, and screenshot options. Hash canonical data with sorted object
keys. It excludes origin, side name, run label, and target URL paths. Those
identify inputs, not capture compatibility. Tool version is checked separately.
Different effective settings or tool versions are incompatible. The comparison
must not silently produce a pixel ratio for incompatible captures.

A failure uses `state: "failed"` and `error: {code, message}`. It has no PNG path.
A run is `partial` until every requested target/viewport has a terminal result.
A run with any failed or missing result remains `partial` after execution.
An HTTP 500 response may still yield a captured screenshot and complete run.
Its availability remains an error. Successful capture does not mean a healthy
site. A navigation exception is a failed capture.

## Screenshot report

A report has `schemaVersion: 2`, `meta`, `runs`, `pair`, `entries`, `causes`,
`findings`, and `rules`. A class is derived, never serialized. `meta.matchBelow`
is 3 by default, in percent. `meta.noiseFloor` is `null` until measured.
`meta.tools` lists tool name, version, and capture settings hash.
Each entry has one row per viewport in the union of requested captures.

```json
{
  "id": "home",
  "kind": "page",
  "title": "Home",
  "path": "/",
  "viewports": [{
    "id": "desktop",
    "state": "complete",
    "availability": {"a": "ok", "b": "http-error"},
    "artifacts": {"screenshot": {
      "a": {"src": "runs/baseline/screenshots/home/desktop.png"},
      "b": {"src": "runs/current/screenshots/home/desktop.png"},
      "diff": {"src": "diff/home/desktop.png", "ratio": 4.2,
               "regions": [{"x": 0, "y": 0, "width": 40, "height": 20, "unit": "px"}]}
    }}
  }]
}
```

All report URLs are relative to the report server root. They stay on its origin.
The server maps report assets and runs without accepting arbitrary file paths.
The screenshot artifact index also records `kind`, `tool`, `version`, and
`settingsHash` under R9.4. `src` is its sidecar path. Preserve full-resolution A
and B images. Difference regions use original pixels. Ratio is a percent from
0 to 100, not a fraction. Detail remains in sidecars, not embedded image data.

Row states are `complete`, `missing`, `failed`, and `incompatible`. They describe
measurement, not site availability. A non-complete row has derived class `null`.
Do not fabricate a zero ratio or an image for it. Retain its diagnostic and
available evidence. Include a target present in only one run as `missing`.
The pure classifier maps a complete row to the four classes in section 8.
An explicit `judge: "oracle"` overrides ratio only for comparable evidence.
Target aggregation retains incomplete rows and summarizes comparable findings.

## Findings and stability

A nonzero ratio produces a screenshot finding when the noise floor is unknown.
A ratio below a measured floor produces no finding. At the floor, it remains a
finding. `matchBelow` is a display hint; it never explains or removes a finding.
Zero ratio without other findings is `match`. Every finding with a known cause
is `explained`; any finding without one is `unexplained`.

A finding has `id`, `targetId`, `viewportId`, `artifact: "screenshot"`, and optional
`causeId`. Causes have `id`, `title`, `detail`, and boolean `known`. Missing or
unknown causes remain unexplained. A rule outside its scope cannot suppress a
finding. v0.1 does not implement normalization or known-difference recording.
Do not invent these features in the viewer.

A future measured noise floor records its measurement runs, settings hash, and
scope. It applies only to compatible captures in that scope. One arbitrary
constant is not a measured noise floor. Original evidence always remains local.

## Acceptance examples

| Evidence | Measurement | Class | Availability |
| --- | --- | --- | --- |
| Same PNGs, both HTTP 200 | complete | match | ok / ok |
| Same PNGs, B HTTP 500 | complete | match | ok / http-error |
| B navigation timeout | failed | null | ok / capture-error |
| Target exists only in A | missing | null | ok / unknown |
| Different viewport dimensions | incompatible | null | retained separately |
| Nonzero ratio, floor unknown | complete | unexplained | retained separately |
| Ratio below measured floor, no findings | complete | match | retained separately |
| Every finding has a known cause | complete | explained | retained separately |
| Rule has wrong pair scope | complete | unexplained | retained separately |

Both viewer and summary use the same pure classifier. Summary reports class
counts, measurement-state counts, availability problems, unexplained target IDs,
omitted counts, and `next`. Its target list obeys `--max-targets`; aggregate
counts cover the full report. A summary with incomplete evidence cannot claim
all targets match. A legacy v1 adapter keeps original data in a `legacy` extension
and must not discard unsupported evidence. Do not infer capture completeness
from absence of findings in an old report.

## Opt-in response artifacts after v0.1

Requirements: R4.2, R6.1, R6.4, R8.7, R8.9, R9.4, R10.6, R11.1.
The default artifact set remains screenshot only. Set configuration
`artifacts: ["screenshot", "html", "status"]`, or use
`capture --side local --artifacts screenshot,html,status`.
HTML and status can also run without screenshots. Checks remain disabled.

One navigation per target and viewport supplies each requested artifact.
HTML stores the server response bytes. It does not store the DOM after scripts.
A component selector affects its screenshot only. HTML holds the full response.
HTML sidecars use `html/<target>/<viewport>.txt`. Each body has a 2 MiB limit.
Playwright buffers the response before the body limit can reject a chunked body.
The limit bounds stored data. It does not claim a streaming transport limit.
An unsupported body or a body above the limit has a failed artifact state.

Status sidecars use `status/<target>/<viewport>.json`. They hold the final HTTP
code, final pathname, redirect pathnames, and asset request, failure, and HTTP
error counts. Redirects have at most 20 steps. Paths have at most 2000 characters.
Do not store cookies, request headers, credentials, or query strings.
The count covers asset requests observed before response-artifact collection.
A failed capture has availability capture-error. Its retained status sidecar
still holds the HTTP code. Status is separate from target class. Status-only reports have no comparable
evidence and must never claim match.

A stored capture adds `artifacts.html` and `artifacts.status` indexes when
requested. Each has `state` (`captured` or `failed`), `path`, `kind`, `tool`,
`version`, `browserVersion`, and `settingsHash`. A successful index records
its byte count. HTML also records the response content type. Each response
artifact has its own settings hash. Screenshot options and the other enabled
artifacts do not change that hash. Screenshot hashes retain the v0.1 contract.
Preserve captured response evidence if later screenshot settlement fails.

A report viewport adds `artifacts.html` and `artifacts.status`. Each has its
own measurement `state`, A/B indexes with `src`, and a comparison index.
The comparison index points to bounded JSON under
`diff/<artifact>/<target>/<viewport>.json`. Raw response bytes remain local.
HTML differences use a linear prefix/suffix replacement window. They do not
claim a minimal edit script. The window shows at most 100 lines and 2000
characters per line. Removed and added counts describe the replacement window.
`displayedLines`, `omittedLines`, and per-line `truncated` describe the limits.
Only UTF-8 response text is compared. An unsupported charset or invalid UTF-8
retains raw evidence and has a failed comparison diagnostic.
No normalization or known-difference recording runs in this slice.

Requested screenshot and HTML states determine the viewport measurement state.
Failed or missing HTML never becomes match. A finding from a complete artifact
remains visible when another requested artifact fails. The aggregate verdict
remains incomplete. Status alone does not provide a comparable class.

The server serves only indexed sidecars. Raw HTML is `text/plain`, with
`nosniff` and the viewer CSP. It never serves active report HTML.
The viewer loads bounded comparison JSON on request. It displays text only.

Use `query REPORT --target ID --viewport ID --artifact html --max-lines 40`
for a bounded HTML window. Use `--artifact status` for bounded HTTP metadata.
The line limit is 1 to 100. Unknown targets, viewports, and artifacts fail.
The JSON answer has evidence paths, measurement state, omitted counts, and
`next`. No arbitrary sidecar fields enter the answer.
