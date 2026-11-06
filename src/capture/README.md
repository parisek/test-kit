# src/capture

Captures one side into a run. One page load feeds every artifact the run asks for. Spec section 4 (R4.2) and section 6.

`capture({configPath, side, label, runsRoot, artifacts, packs})` returns the run, run directory and
manifest path. It loads and freezes project configuration. It starts Chromium
on the host. Install `@playwright/test` and its Chromium browser first.

Each target and viewport gets an isolated browser context. Capture stores one
navigation response status and the requested artifacts. Screenshots are the default.
Optional artifacts are HTML response bytes and HTTP metadata. It blocks nonlocal requests in
all frames and popups. A side with `remote: true` reads its own origin with GET and HEAD,
drops frames and subresources of other origins without failing, and blocks a top-level
navigation, popup, redirect or non-read method that leaves it. It blocks requests that submit data. It checks redirect
destinations before network access. It does not save cookies or credentials.
A remote side with `userAgent` sends that User-Agent on every request (R3.4). The run
settings record it. It is not part of the settings hash, like the certificate option.
A remote side with `challenge: "cloudflare"` also sends a POST that is not a navigation to
`/cdn-cgi/challenge-platform/` on its own origin, when each path segment below it holds only letters, digits and `._~:+=-` (R3.5). A redirect of
that POST fails the capture. Every other non-read request still fails.
A remote run stops at a `cf-mitigated` header on an own-origin response, or a 403 or 429 on the page
(R3.6). That capture fails with `REMOTE_EDGE_STOP`; the later ones fail with `RUN_STOPPED` and send nothing.
A remote capture records each request it aborts and keeps, per resource type and origin, as `dropped` (R3.8). The record has no path or query. It holds at most 50 entries.
A side with `thirdParty`, local or remote, sets the mode for a GET or HEAD frame or subresource of another origin (R3.10): `"drop"` aborts it and keeps the capture, `"block"` fails the capture. Unset, a local side blocks and a remote side drops. A top-level navigation and every non-read method still fail. The value is part of the settings hash. A dropped request enters the `dropped` record on either side.
A side with `allowOrigins`, local or remote, also reads the named HTTPS origins with GET and HEAD for the named resource types (`stylesheet`, `font`) (R3.9). A navigation never uses the list. A redirect from an allowed origin must end at an allowed origin. A local side verifies the certificate of these origins through a separate verifying context. The list is part of the settings hash.
Service workers are blocked. HTTPS errors are ignored for local DDEV certificates.
WebSockets are blocked, including local sockets. Version 0.1 captures a static
state. It does not permit socket traffic. This policy is part of the settings
hash. Playwright 1.49 or newer is required for the socket guard.
The run records these fixed browser settings in its capture settings hash.
It records the actual Chromium version as well as the Playwright version.

DDEV origins require a nearest ancestor `.ddev` directory. Capture runs
`ddev describe --json-output` before Playwright loads. The description must
show a running project and the configured host. A stopped project stops
capture with "The DDEV project is not running (status: stopped). Run ddev
start." No browser starts and no run directory exists. Capture then runs
`ddev mutagen sync` once before browser work. A wrong checkout or sync
failure stops capture.

`capture({..., targets, viewports})` takes lists of IDs. The run captures only the selected cells and records
`selection` in `run.json`. `settings` keeps the full lists, so no settings hash changes (R4.5). `selection.js`
holds the pure logic. `run.state` is `complete` when every selected cell is captured.

The manifest starts as partial and updates atomically after each capture.
The screenshot timeout bounds the complete target operation, including font
settlement. A timeout closes its browser context before the next target starts.
Failures retain diagnostics and omit PNG paths. A failed result keeps the run
partial. HTTP errors can retain screenshot evidence. Original PNG dimensions
and device scale factors remain explicit. Images have a 40 million pixel limit
and a 30000 pixel height limit. Selector screenshots use the first match. That match must be visible.

Opt-in HTML and status reuse the navigation response (R4.2).
Each response artifact has its own provenance and failure state.
A failed requested response artifact keeps the run partial. HTML and status
can run without a screenshot. Completed response evidence survives a later
screenshot failure. Raw HTML stays local and has a 2 MiB storage limit.

A target can set `selector` to a string or an array of 1..50 selectors.
A string keeps the element screenshot path. An array captures the union of
the first match for each selector. Each match must be visible. A missing
match fails capture.
A union outside the viewport uses a document clip. The image limits apply
before capture, including the device scale factor.

Set `box: "content"` on a target to omit CSS padding and borders. Content
clips round outwards to CSS pixels. Transformed content boxes are unsupported. Content targets with reserved
scrollbar gutters or automatic/scrolling overflow are unsupported.
The default remains the border box. Page screenshots do not accept `box`.
New scoped modes require settled animations when `disableMotion` is true.
An active animation fails capture before the crop uses unstable geometry.

Each new screenshot records a scope hash. Comparison also checks the stored
target selector and box. A changed scope is incompatible for that target.
Changes to another target do not change this result. Recorded acceptance
binds the same scope to the raw screenshot bytes. Paths can differ between
sides. Titles and paths do not define screenshot geometry (R4.4, R13.11).

Settlement stays opt-in. Set `lazyImages: true` in a settle recipe to sweep
the page before capture. The sweep has limits of 50 steps, 30000 CSS pixels,
and 1000 visible images. Image load and decode each have a 2-second limit.
An unfinished load or growing page fails capture. A broken image stays
available for content checks. The sweep restores the original scroll position.

A recipe can set `reveal` to at most 20 `{action, selector}` steps. Actions
are `click`, `hover`, and `focus`. They run before wait selectors. A reveal
cannot navigate another page, open a popup, or submit a request.

A recipe can set `pin` to at most 20 selectors (R5.12). After the reveal and wait
steps and before the lazy-image sweep, each match gets an inline
`position: static !important`. A selector with no match fails the capture. The
step sends no request and does not change the engine version.

Targets can set partial `settle` overrides and `settleBySide` overrides for
configured sides. Scalar options inherit. An explicit array replaces the
inherited array. The report timeline shows the global recipe and target
overrides (R5.4). Screenshot, content, and behavior comparison bind the
effective recipe. A changed recipe is incompatible for that target.
Defaults retain their previous capture hashes.

## Packs (`--packs`, R13.51)

`capture --packs` runs the packs of the `packs` key that have a page step. Today this is `a11y`. The step runs on the page that capture already has open, after settlement and content, and after the screenshot when there is one, before the behavior steps. A remote side refuses `--packs` before a browser starts. It adds no navigation and no request, and the request policy and the timeouts stay as they are. `src/packs/select.js` plans the run and `packs.js` runs it.
Each result is a sidecar `<pack>/<target>/<viewport>.json` and an index `captures[].artifacts.<pack>`. A pack that is missing (axe-core is not installed) or broken stores the reason and makes the run `partial`.
`run.packs` records `selected` and `skipped` (a pack with no page step). It exists only when the flag is set. The selection is not in the settings hash or in the comparable tools. Without the flag nothing here runs (R5.1).
`--packs` with no `packs` key fails before a run directory exists.
## Styleguide targets

With `targetSource` in the configuration, `capture` first reads `<mount>/api/components` of the named side (one GET, no redirect).
It makes one `component` target for each entry and stores the list in the run settings.
The run manifest holds `targetSource` with the count and the IDs that have no fixture.
It reads before any run directory exists, so a bad catalogue leaves no run. `--side` must be the side of the source.
A component with `has_styleguide: false` makes no target and sends no request. The manifest lists it under `targetSource.noFixture`, and the report and `summary` list it as "no fixture".
With `variants: true` it also makes one target for each variant. With `pages: true` it reads `<mount>/api/pages` (a second GET) and makes one `page` target for each page.
See `src/styleguide/README.md`.
