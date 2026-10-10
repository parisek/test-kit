# src/capture

Captures one side into a run. One page load feeds every artifact the run asks for. Spec section 4 (R4.2) and section 6.

`capture({configPath, side, label, runsRoot, artifacts})` returns the run, run directory and
manifest path. It loads and freezes project configuration. It starts Chromium
on the host. Install `@playwright/test` and its Chromium browser first.

Each target and viewport gets an isolated browser context. Capture stores one
navigation response status and the requested artifacts. Screenshots are the default.
Optional artifacts are HTML response bytes and HTTP metadata. It blocks nonlocal requests in
all frames and popups. It blocks requests that submit data. It checks redirect
destinations before network access. It does not save cookies or credentials.
Service workers are blocked. HTTPS errors are ignored for local DDEV certificates.
WebSockets are blocked, including local sockets. Version 0.1 captures a static
state. It does not permit socket traffic. This policy is part of the settings
hash. Playwright 1.49 or newer is required for the socket guard.
The run records these fixed browser settings in its capture settings hash.
It records the actual Chromium version as well as the Playwright version.

DDEV origins require a nearest ancestor `.ddev` directory. Capture runs
`ddev describe --json-output` verifies that the checkout serves the configured
host. Capture runs `ddev mutagen sync` there once before browser work.
A wrong checkout or sync failure stops capture.

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

Targets can set partial `settle` overrides and `settleBySide` overrides for
configured sides. Scalar options inherit. An explicit array replaces the
inherited array. The report timeline shows the global recipe and target
overrides (R5.4). Screenshot, content, and behavior comparison bind the
effective recipe. A changed recipe is incompatible for that target.
Defaults retain their previous capture hashes.
