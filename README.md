# test-kit

`@parisek/test-kit` compares two local runs. A project supplies its
sides, target paths, viewports, and settle settings. Capture records evidence.
Compare reads stored runs. The viewer and JSON summary use the same classifier.

Version 0.1 supports screenshots only. No content checks run by default.
The unreleased development build also supports opt-in HTML and HTTP status.
Main also supports opt-in stored content checks. Behavior, speed, and lint integration remain later milestones.
The Node engine belongs here. PHP and Twig lint belong to
[`lint-kit`](https://github.com/parisek/lint-kit).

## Install

Use Node 20 or later. Install from an exact git tag, not the npm registry.
Run installation in the project theme directory. DDEV projects may use
`ddev npm install` there. Run Chromium capture on the host against the DDEV URL.

```sh
npm install -D github:parisek/test-kit#v0.1.0
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

HTML and HTTP status are opt-in response artifacts in the unreleased build.
These commands are not part of v0.1.0. Use

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

The opt-in demo also previews behavior, content and Lighthouse interfaces.
The behavior tab runs a local disclosure contract and retains a failed step. Lighthouse prototype panels use simulated fixtures. The content tab uses real stored DOM snapshots and enabled checks.
They do not enter report findings, target classes or agent query results.
The content overview appears when a report has content evidence. Speed previews use the demo prototype marker.
The final artifact schema, runners and evidence loading remain future work.

### Stored content checks (unreleased)

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

### Project behavior contracts (unreleased)

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
