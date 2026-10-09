# src/capture

Captures one side into a run. One page load feeds every artifact the run asks for. Spec section 4 (R4.2) and section 6.

`capture({configPath, side, label, runsRoot})` returns the run, run directory and
manifest path. It loads and freezes project configuration. It starts Chromium
on the host. Install `@playwright/test` and its Chromium browser first.

Each target and viewport gets an isolated browser context. Capture stores one
navigation response status and a screenshot. It blocks nonlocal main-frame
requests and requests that submit data. It does not save cookies or credentials.
Service workers are blocked. HTTPS errors are ignored for local DDEV certificates.
The run records these fixed browser settings in its capture settings hash.

DDEV origins require a nearest ancestor `.ddev` directory. Capture runs
`ddev mutagen sync` there once before browser work. A sync failure stops capture.

The manifest starts as partial and updates atomically after each capture.
Failures retain diagnostics and omit PNG paths. A failed result keeps the run
partial. HTTP errors can retain screenshot evidence. Original PNG dimensions
and device scale factors remain explicit. Images have a 40 million pixel limit
and a 30000 pixel height limit. Selector screenshots use the first visible match.
