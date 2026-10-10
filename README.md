# test-kit

`@parisek/test-kit` compares two local runs. A project supplies its
sides, target paths, viewports, and settle settings. Capture records evidence.
Compare reads stored runs. The viewer and JSON summary use the same classifier.

Version 0.2 supports screenshots and opt-in HTML, HTTP status, stored content
checks, project behavior contracts and local Lighthouse measurements.
No content checks run by default. Legacy command and lint migration remain open.
The Node engine belongs here. PHP and Twig lint belong to
[`lint-kit`](https://github.com/parisek/lint-kit).

## Install

Use Node 20 or later. Install from an exact git tag, not the npm registry.
Run installation in the project theme directory. DDEV projects may use
`ddev npm install` there. Run Chromium capture on the host against the DDEV URL.

```sh
npm install -D github:parisek/test-kit#v0.2.0
npm install -D @playwright/test
npx playwright install chromium
```

## Configure

Save `test-kit.config.json` in the theme directory. Use the local project origin.
Keep `tests/visual/runs/` and comparison output outside git.

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
- [Roadmap](https://github.com/parisek/test-kit/issues/5).

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
Snapshot retention remains a project decision.

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

The engine and pure helpers still support Node 20. Lighthouse 13.5 requires
Node 22.19 or newer and the optional `lighthouse` peer. The development dependency
is pinned to 13.5.0. Measurement accepts local HTTP page targets only.
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
