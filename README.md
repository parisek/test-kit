# test-kit

`@parisek/test-kit` compares two runs of a local or remote side. A project supplies its
sides, target paths, viewports, and settle settings. Capture records evidence.
Compare reads stored runs. The viewer and JSON summary use the same classifier.

Version 0.2 supports screenshots and opt-in HTML, HTTP status, stored content
checks, project behavior contracts and local Lighthouse measurements.
No content checks run by default. Legacy command and lint migration remain open.
The Node engine belongs here. PHP and Twig lint belong to
[`lint-kit`](https://github.com/parisek/lint-kit).

## Install

Use Node 20.19 or later. Install from an exact git tag, not the npm registry.
Run installation in the project theme directory. DDEV projects may use
`ddev npm install` there. Run Chromium capture on the host against the DDEV URL.

```sh
npm install -D git+https://github.com/parisek/test-kit.git#v0.3.0
npm install -D @playwright/test
npx playwright install chromium
```

One consumer project saw this once, with npm 11.19 and 11.20. `package-lock.json` held a `git+ssh://git@github.com/...` URL for this dependency. The spec was `git+https`. This is npm behaviour, not a choice of this package. A project whose rules require HTTPS can set the `resolved` scheme to `git+https://github.com/parisek/test-kit.git#<commit>` by hand. Then install with `npm ci`. Verified once on one consumer project on 2026-10-19: `GIT_SSH_COMMAND=false npm ci` in a clean cache installs and leaves the lockfile unchanged, and `npm ls` shows the https URL. `npm ci`, `npm ls` and `npx test-kit --version` leave the scheme alone. `npm install` and `npm install --package-lock-only` write `git+ssh://` back (measured on a copy). A DDEV `post-start` hook that runs `npm install` rewrites it on every `ddev start` (measured on one consumer project on 2026-11-05). The fix is on the project side: run `npm ci` in that hook, or skip the install when `node_modules` already matches the lockfile. Run `git diff package-lock.json` before every commit.

## Configure

Save `test-kit.config.json` in the theme directory. Use the local project origin.
Runs go to `test-kit/runs/` by default. The store `test-kit/` is the one folder of test-kit output. Deleting it costs only the current baseline. A new store gets a `.gitignore` with `*`. Git-ignored is not deploy-excluded: the store holds page captures, so exclude `test-kit/` from every deploy (for example an rsync exclude). Set `runsRoot` to use another path.

Up to 1.1 the default store was `.test-kit/`. A command that finds one beside the configuration prints one line on stderr. Delete it by hand. test-kit never reads, moves or deletes it.

An explicit `--store` keeps the old store for `run`, `before`, `after`, `report`, `history` and project `perf` (`--store .test-kit`). An explicit `runsRoot` keeps working for `capture`, `import`, `diff` and plain `perf`. Replace `.test-kit/` with `test-kit/` in the project `.gitignore` and in any deploy or rsync exclude list.

```json
{
  "schemaVersion": 1,
  "sides": {
    "local": {
      "origin": "http://localhost:8080",
      "settle": {"waitMs": 0, "selectors": [], "disableMotion": true, "masks": []}
    }
  },
  "targets": [{"id": "home", "kind": "page", "title": "Home", "path": "/"}],
  "viewports": [{"id": "desktop", "width": 1280, "height": 800}],
  "artifacts": ["screenshot"],
  "checks": []
}
```

## Compare

Capture before and after a change. The capture command prints each run ID.
Use those IDs in the comparison command. Use an empty output directory.

```sh
npx test-kit capture --config test-kit.config.json --side local --label before
npx test-kit capture --config test-kit.config.json --side local --label after
npx test-kit diff <run-a> <run-b> --output tests/visual/report
npx test-kit summary tests/visual/report/report.json --filter all --max-targets 20
npx test-kit serve tests/visual/report/report.json
```

The server prints its loopback URL. Stop it after review. A failed capture is
incomplete evidence. An HTTP error remains visible even when screenshots match.
An unknown noise floor is explicit. A pixel ratio is a compass, not a verdict.
Client captures and project configuration stay local.


## Compare a deployed site

A side may be a deployed site. Set `remote: true` on it. Its origin may be any
HTTP or HTTPS origin without credentials or a path. The default stays local.

```json
{
  "sides": {
    "local": {"origin": "http://localhost:8080"},
    "production": {"origin": "https://www.example.com", "remote": true}
  }
}
```

```sh
npx test-kit capture --config test-kit.config.json --side production --label before
npx test-kit capture --config test-kit.config.json --side local --label after
npx test-kit diff <production-run> <local-run> --kind migration --output tests/visual/report
```

A remote capture is read-only. It sends GET and HEAD requests to its own origin.
It aborts frames and subresources of other origins, such as a tag manager, and
keeps the capture. It fails the capture on a redirect, popup or top-level
navigation to another origin, and on any method other than GET and HEAD, to any origin. It does not send
cookies or credentials. A remote side verifies TLS certificates. A local side ignores certificate errors for self-signed DDEV certificates. `perf` and `--ddev` refuse a remote side. Use the same
`settle` recipe on both sides, or the comparison reports incompatible settings.

A site firewall can block the default User-Agent of headless Chromium, which
contains `HeadlessChrome`. The capture then records a 403. A remote side may set
`userAgent` to an honest name, for example a browser User-Agent that ends in
`test-kit/1.0`. Do not use it to hide the tool. Every request of that side sends
it. A local side refuses the key. The run settings record the value, but it does
not enter the capture settings hash, so the pair stays comparable. A site can
serve different markup for a different User-Agent. A migration pair then
compares two User-Agents, so read a finding with that in mind.

```json
"production": {"origin": "https://www.example.com", "remote": true,
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 test-kit/1.0"}
```

A CDN can run JavaScript bot detection on every page. Cloudflare sends a `POST`
to `/cdn-cgi/challenge-platform/` on the site origin, and the capture fails on it.
A remote side may set `"challenge": "cloudflare"`. The capture then lets that
`POST` through, and only that kind: a fetch, XHR or beacon to a path below it with plain
characters, never a navigation or a form. Set the key only for a site behind
Cloudflare. The CDN edge answers it, not the site. Every
other non-read request still fails the capture, and so does a redirect of the allowed `POST`. An interstitial challenge page,
a 403 with `cf-mitigated: challenge`, still fails. A local side refuses the key.

A remote run stops at the first sign that the edge challenges or limits it: a
`cf-mitigated` header on any response of the origin, or a 403 or 429 on the page.
That capture fails with `REMOTE_EDGE_STOP`. The rest of the run fails with
`RUN_STOPPED` and sends no request, so a challenge does not grow into a ban.

A remote side aborts a request to another origin (a local side blocks it). A web font from a font host is such a
request, and the page then renders in the fallback font. `run.json` records the aborted
requests per resource type and origin (no path or query), and `summary` and the viewer
warn when a `font` or `stylesheet` request was aborted. To load the font, name its origin:

```json
"production": {"origin": "https://www.example.com", "remote": true,
  "allowOrigins": [{"origin": "https://use.example-site.net", "types": ["stylesheet", "font"]}]}
```

The capture then reads that exact HTTPS origin with GET and HEAD for the named types
(`stylesheet`, `font`). Name a font host that loads CSS from one origin and fonts from another
with one entry for each origin. It never uses the list for a navigation, and a redirect from
an allowed origin to an origin that is not named fails the capture. The capture verifies the
certificate of a named origin. A local side may set the same key, so a local side can load a
web font from a named third-party origin. A failed request to a named origin, or an HTTP error answer such as a 404 for a font file, fails the capture. A request to a named origin sends its URL and headers, including the `Referer` of the page, to that origin. The list is part of the capture settings hash. A pair
with a list on one side only is incompatible, and the diagnostic names `allowOrigins`.

A page can embed content from another origin, for example a video frame. A local side fails the capture
on such a request, and a remote side aborts it and keeps the capture. To give both sides the same rule,
set `thirdParty` on both sides (R3.10):

```json
"production": {"origin": "https://www.example.com", "remote": true, "thirdParty": "drop"},
"local": {"origin": "http://localhost:8080", "thirdParty": "drop"}
```

`"drop"` aborts a GET or HEAD request for a frame or subresource of another origin and keeps the capture.
A local side sends nothing to that origin, unless `allowOrigins` names it. On a local side the key applies to a non-local origin only: a request to another loopback or DDEV host (`localhost`, `127.x.x.x`, `*.ddev.site`) stays allowed, with any port. `"block"` fails the capture, with the error that names the
request. Without the key, a local side blocks and a remote side drops. A top-level navigation to another
origin, a redirect that leaves the permitted origins and every other method still fail the capture. The
value is part of the capture settings hash, so set the same value on both sides. The template sets `"thirdParty": "drop"` on its one side. A project that adds a second side sets the same value there. A pair with different
values is incompatible, and the diagnostic names `thirdParty`. Each dropped request appears in the
`dropped` record of the capture, on a local and on a remote side.

Other aborted requests are not evidence. A page that needs such a request to render
differs from the same page with it, so read an `unexplained` finding with that in mind.

## Lazy images and reveal

An image with `loading="lazy"` below the first screen stays grey in a full-page capture, because the page never scrolls to it. Set `settle.lazyImages` to `true`. The capture then scrolls the page once, loads every lazy image and scrolls back. `settle.reveal` clicks, hovers or focuses named elements before the capture. Both keys are off by default.

Set the same `settle` on both sides. The recipe enters the settings hash. A pair where one side has `lazyImages` and the other has not is `incompatible`, and the other side needs a new capture. The row diagnostic names the setting and both values, for example `settle.lazyImages (A: false, B: true)`. `templates/test-kit.config.json` shows two sides with one `settle` recipe.

```json
"settle": {"waitMs": 0, "selectors": [], "disableMotion": true, "masks": [], "lazyImages": true}
```

## Scoped project workflow

The package owns command routing, selections, baselines, and local history.
A project keeps configuration, trusted behavior contracts, and command aliases.
These commands are opt-in. Low-level capture and diff remain available.

```sh
test-kit run --target home --suite content --checks heading-outline,empty-alt
test-kit run --path /example --suite visual --viewport mobile
test-kit run --target home --selector '#header' --viewport mobile
test-kit run --target home --suite behavior --contracts navigation
test-kit before --target home --suite visual
test-kit after --target home --suite visual
test-kit report
test-kit history
test-kit perf --side local --ddev --path /example --runs 3
```

Use `--ddev` to discover the current DDEV loopback HTTP origin. With `--ddev` the
origin in the configuration is not used. The loopback origin from `ddev describe`
replaces it. So the side may name an `https://*.ddev.site` origin in the
configuration. Run the browser
on the host. Install dependencies and build inside DDEV. Flush Mutagen before
capture when the project uses it. `--side` defaults to `local`.

`--store PATH` selects a stable directory relative to the config file (default `test-kit`).
It holds runs, reports, baseline state and the store viewer. A new store ignores itself in Git.
A selection has its own baseline. A partial capture cannot replace it.
A standalone run records one capture. It does not invent a comparison verdict.
History lists all stored evidence and opens existing A/B reports. No automatic
retention or deletion is enabled.

Content checks use `id`, `title`, `applies`, and `check`. They read stored content.
Select them with `checks` in config or `--checks`. Browser behavior contracts
use `name`, `detect`, and `run`. Select them with `behavior.enabled` or
`--contracts`. Omit `behavior.enabled` to retain existing selection. An explicit
empty list selects no behavior contract. Unknown and duplicate names fail.
A skipped contract or empty selection is not evidence of a passed assertion.
Use `--checks none` or `--contracts none` to disable that group for one run.
Component selector capture supports visual evidence. Component content
extraction remains unsupported.

## Static export

Static export requires v0.4.0 or newer.

The package writes data to disk. A static viewer reads it. The Node server (`report`, `history` without a flag) is a convenience, not a requirement (ADR 0005).

Export a comparison or the stored history without starting a Node server:

```sh
test-kit report --export test-kit/export/pair-001
test-kit report --run RUN_ID --export test-kit/export/pair-002
test-kit history --export test-kit/export/history-001
```

Output paths are relative to the project config directory. The destination must
not exist. Exports contain the viewer and only allowed evidence. History uses
relative links to saved report viewers and standalone feedback pages.
A static host can mount the directory at `/` or at a nested URL prefix.
No hosting, authentication, retention, or deletion is configured by this command.
Ignore the export directory in the consuming project.

Raw page HTML and Lighthouse HTML use generated text filenames. They cannot
execute as HTML under normal static MIME handling. Open a downloaded Lighthouse
report locally if you need its interactive native interface. Exported evidence
links point to the safe text copies. The source evidence stays unchanged.

### The store viewer

The workflow commands `run`, `before`, `after`, `report` and project `perf` refresh a static viewer at the store root. The low-level commands `capture`, `import`, `diff` and plain `perf` do not. No flag is needed (R10.16, #312). The store then holds `index.html`, `app.js`, `style.css`, `favicon.svg` and `index.json` beside `runs/` and `reports/`. Serve the store from any static server and open it:

```sh
cd test-kit && python3 -m http.server --bind 127.0.0.1 8080
```

The viewer reads `runs/<id>/run.json` and `reports/<id>/report.json` in place. It copies nothing. Each file is written as a temp file plus a rename, so there is no folder swap and no lock folder. Deleting the store loses the viewer. The next command writes it again.

A report whose evidence holds raw HTML (a Lighthouse report) is listed without a path, with a warning. A static server would send that file as active content. Use `history --publish DIR`, which makes inert copies. A failed refresh is a warning and never changes the exit code. The store holds page captures. Keep it out of deploys, and do not expose it on a public server.

### Publish a stable directory

`history --publish DIR` refreshes one stable directory in place (R10.12, R10.13, ADR 0005). It is opt-in. `DIR` has no default and no config key. It comes from the flag and is relative to the config directory.

```sh
test-kit history --publish site
```

`DIR` holds a marker `.test-kit-publish`, an `index.json`, one shared viewer copy, `runs/<id>/run.json` and `reports/<id>/` with `report.json` and allowed evidence. The command copies no run artifact. A store entry that is unreadable, or a report whose evidence is missing or too large or that fails validation, appears in `index.json` with `path` `null`. The command prints a warning and exits 0 for the report case. Any other report error (for example a corrupt sidecar, or a sidecar that escapes the report root) stops the refresh and names the report. Fix or remove that report, then run the command again. The history store must exist; a missing `--store` path is refused before any write.

The command refuses these `DIR` values before it writes anything: a missing or non-directory history store, a path in, equal to or above the history store, the root, the home directory, the working directory or a parent of it, a mount point, a symbolic link, a file, a non-empty directory without the marker, and a marked directory with a foreign entry. It cannot combine with `--export` or `--port`.

Beside `DIR` the command makes three siblings: `DIR.test-kit-lock`, `DIR.test-kit-new` and `DIR.test-kit-old`. Add all three to `.gitignore`. After a crash, the next run refuses to start. It prints the paths and the one-line action from the recovery table in R10.12 and deletes nothing. The refresh is not atomic: a reader can see a missing `DIR` for a short time between two renames. Put server rules such as `.htaccess` outside `DIR`.

On success the command writes `test-kit: published to <absolute dir>; the directory contains captured pages.` to stderr. `run.json` holds the run `settings`, so the directory publishes them. The package never uploads or exposes `DIR`. The project decides what its web server does and who can read it.

The viewer in `DIR` reads `index.json` with `fetch`. A browser blocks that on a `file://` URL. Open `DIR` through any static web host, for example `python3 -m http.server --bind 127.0.0.1` in `DIR`. The directory contains captured pages, so keep it local unless the project decides to share it.

See [static export requirements](https://github.com/parisek/test-kit/issues/86).

## Development

```sh
npm ci
npm test
npm ci --prefix frontend
npm run test:viewer
npm run build:viewer
npm run check:viewer
node bin/cli.js --help
```

- [Specification](docs/specification.md), synchronized with
  [the parent issue](https://github.com/portadesign/tailwind-base/issues/873).
- [Screenshot contracts](docs/contracts.md).
- [Local workflow](docs/usage.md).
- [Release procedure](RELEASING.md).
- [The project seam](docs/seam.md): what the 1.0 release candidate freezes.
- [Upgrade from v0.5.0](docs/upgrade-from-0.5.md).
- [Migration guide for a project that pins an old version](docs/migration-guide-tailwind-base.md).
- [Roadmap](https://github.com/parisek/test-kit/issues/5).
- [Scoped workflow and history](https://github.com/parisek/test-kit/issues/84).

The package uses the MIT licence. Installation needs no build step.
Viewer development uses Node 22.18 or later. See [the frontend guide](frontend/README.md).
The package commits the Vue and Tailwind build. CI verifies it against its source.

HTML and HTTP status are opt-in response artifacts in v0.2.0. Use

```sh
test-kit capture --side local --artifacts screenshot,html,status
test-kit query report.json --target home --viewport desktop --artifact html --max-lines 40
```

The default remains screenshots only. See [response contracts](docs/contracts.md#opt-in-response-artifacts-after-v01).

Try the visual workspace with anonymous local fixtures:

```sh
npx playwright install chromium
npm run demo -- --port 4183
```

Open the printed local URL. The demo captures five targets at desktop and mobile widths.
It includes an unexplained page change, a small component size change, an accepted price change,
an unchanged catalogue, and an HTTP 503 response. The viewer shows originals, overlay,
pixel differences, HTML line changes, and HTTP evidence. All demo data stays in `.test-kit/demo/`.
Stop the server with Ctrl+C. This command is opt-in and does not change a project configuration.
The layout uses the [visual reference](https://claude.ai/artifact/9ahvV58EoBk3ZGr9634w2N)
and the copied company UI contract. It does not copy reference sample data.

The behavior tab runs a local disclosure contract and retains a failed step.
The content tab uses real stored DOM snapshots and enabled checks.
These measured artifacts enter findings, classifications and agent queries.
The basic demo also has simulated Lighthouse prototype panels. Those panels do
not enter measured findings or agent queries. Run `npm run demo:perf` for real
local Lighthouse measurements and original audit reports.

### Stored content checks

Add `content` to `artifacts`. Select checks explicitly in `checks`.
Supported IDs: `heading-outline`, `lang`, `empty-alt`, `empty-title`,
`internal-links`, and `text-difference`. Set `content.expectedLanguage` for
the language check. There are no default checks.

Capture stores bounded, gzip-compressed extracted fields and the settled DOM body locally.
Comparison reads the snapshot. It performs no crawl. Internal links use only
HTTP responses already measured for targets in the same viewport. An unmeasured
link remains unknown. Component-scoped content capture is not supported yet.
It records failed evidence instead of using the whole page as a component.

To rerun checks over stored runs:

```bash
test-kit diff RUN_A RUN_B --output report-title --checks empty-title
test-kit query report-title/report.json --target home --viewport desktop --artifact content --max-lines 10
```

The original run manifests and snapshots stay unchanged (R7.1, R9.6, R12.3).
Nothing removes snapshots automatically (specification section 17, item 4).

### Project behavior contracts

Add `behavior` to `artifacts`. Set `behavior.source` to a project directory.
Each `*.contract.js` exports one contract or several named contracts.
The project owns these files. The package owns the registry and runner.
The source directory contains its local helper imports. A bounded source hash
and the project lockfile bind the exact contract policy.

`behavior.projects` maps viewport IDs to contract project names.
`behavior.emulate` sets media before navigation. Contracts that need other media
record incompatible evidence. Passive artifacts run first. Contract steps run
on the same guarded local page. Remote requests, submissions and WebSockets
remain blocked. Missing contract markers do not prove a pass.

The viewer shows A/B steps, errors, screenshots and event evidence.
With `behavior.trace: true`, traces stay local. The viewer shows the command
to open them. Scoped queries accept `--artifact behavior --max-lines 10`.
The legacy reporter, coverage and old command migration remain separate work
under #25 and #45.

### Local Lighthouse measurements

The engine and pure helpers support Node 20.19. Lighthouse 13.6 requires
Node 22.19 or newer and the optional `lighthouse` peer. The development dependency
is pinned to 13.6.0. Measurement accepts local HTTP page targets only.
HTTPS and component targets fail explicitly.

```bash
test-kit perf --side local --targets home --label before --runs 3
test-kit perf --side local --targets home --label after --runs 3 --budget lcp_ms=2500,cls=0.1
test-kit diff RUN_A RUN_B --output speed-report
test-kit query speed-report/report.json --target home --viewport desktop --artifact lighthouse --max-lines 10
```

The fixed desktop preset uses 1280 × 900. It retains a configured matching
`desktop` viewport ID; otherwise the ID is `performance`. Mobile uses 390 × 844.
Each set has one discarded warmup and three to five measured audits. Reports
show medians, samples and full observed spread. Significant improvements and
regressions become findings. The default command exit does not judge them.

More than three targets requires `--consent` after the command states its cost.
A side with `"production": true` in its configuration is a production side.
There `perf` requires `--consent` for any number of targets, one included.
The side id does not mark production.
High machine load refuses capture. `--allow-high-load` marks such measurements
suspect. They cannot produce a speed regression comparison. `--fail-on-budget`
is the only budget option that changes exit status. It works on measurement
and comparison commands. Budgets stay explicit in the saved run.

Speed environment identity uses the stored side and canonical origin. A side
that changes origin does not prove a regression. This restriction applies to
speed only. Screenshot and content compatibility retain their existing rules.

Raw Lighthouse JSON and HTML stay under local runs. HTML links download the
original report. Open it locally for the native Lighthouse interface. To build a real anonymous speed demo, run `npm run demo:perf`.
It measures one page twice and opens a separate local report on port 4185.
It does not run as part of the normal visual demo.
