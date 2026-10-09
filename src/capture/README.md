# src/capture

Captures one side into a run. One page load feeds every artifact the run asks for. Spec section 4 (R4.2) and section 6.

`capture({configPath, side, label, runsRoot})` returns the run, run directory and
manifest path. It loads and freezes project configuration. It starts Chromium
on the host. Install `@playwright/test` and its Chromium browser first.

Each target and viewport gets an isolated browser context. Capture stores one
navigation response status and a screenshot. It blocks nonlocal requests in
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
and a 30000 pixel height limit. Selector screenshots use the first visible match.
