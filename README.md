# test-kit

`@parisek/test-kit` compares two local screenshot runs. A project supplies its
sides, target paths, viewports, and settle settings. Capture records evidence.
Compare reads stored runs. The viewer and JSON summary use the same classifier.

Version 0.1 supports screenshots only. No content checks run by default.
HTML, behavior, content, speed, and lint migration remain later milestones.
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

HTML and HTTP status are opt-in response artifacts. Use

```sh
test-kit capture --side local --artifacts screenshot,html,status
test-kit query report.json --target home --viewport desktop --artifact html --max-lines 40
```

The default remains screenshots only. See [response contracts](docs/contracts.md#opt-in-response-artifacts-after-v01).
