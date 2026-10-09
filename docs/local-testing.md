# Local testing

Use a synthetic site for public evidence (R12.4). Keep project runs outside git
(R12.1). Run each browser on the host. Run a CMS web server inside DDEV.
Do not connect these checks to production.

## Synthetic HTTP fixture

Start two independent local sites from the repository root:

```sh
node tests/integration/example-site-server.mjs --port 4173 --variant baseline
node tests/integration/example-site-server.mjs --port 4174 --variant changed
```

Each command prints its origin. Stop it with Ctrl+C. Port `0` selects a free
port. The default host is `127.0.0.1`. The server has no external assets,
random values, timestamps, fonts or cookies. The motion route is an explicit
exception to stable pixels. Use reduced motion when capture must be stable.

| Path | Response | Purpose |
| --- | --- | --- |
| `/` | 200 | Basic page |
| `/unchanged` | 200 | Equal HTML and pixels in both variants |
| `/changed` | 200 | Text and card colors change in the changed variant |
| `/redirect` | 302 to `/unchanged` | Final URL and redirect evidence |
| `/status/500` | 500 | Failed HTTP response with readable HTML |
| `/missing` | 404 | Missing path |
| `/delayed-asset` | 200 | Image load after the configured asset delay |
| `/motion` | 200 | Animation; reduced motion stops it |

Use `--asset-delay-ms 500` to configure the image delay. Its default is 100 ms.
These values configure the fixture. They are not measured performance results.
Unknown paths return 404. The fixture does not serve arbitrary files.

Run the route checks explicitly:

```sh
node tests/integration/check-example-site.mjs
```

This command starts two loopback servers and closes them after the checks.
`npm test` does not run it. It needs no browser or package dependency.
The route checks do not prove screenshot equality or capture settling.
A browser integration check must compare full-resolution images separately.

A browser test can import the fixture API:

```js
import { startExampleSite } from './example-site-server.mjs';
const site = await startExampleSite({ variant: 'baseline' });
try {
  // Use site.origin with the browser or capture command.
} finally {
  await site.close();
}
```

The API accepts `port`, `host`, `variant`, and `assetDelayMs`. Use port `0` in
parallel tests. Each instance keeps its own variant. Fixture data lives in
`tests/fixtures/example-site/`. The HTTP harness lives in `tests/integration/`.

## Isolated DDEV pilot

Use a separate checkout for the pilot. Do not run database imports, migrations,
module updates or destructive commands in an existing project.
Choose a unique DDEV project name, for example `example-site-test-kit-drupal`.
Use another name for a WordPress pilot.

1. Create the isolated checkout outside the active project's directory.
2. Check that its `.ddev/config.yaml` has the unique project name.
3. Keep the CMS type and docroot from the skeleton. Do not guess them.
4. Run `ddev start` in that checkout.
5. Run `ddev describe` and obtain the local web URL.
6. Verify Node and git inside the container:

   ```sh
   ddev exec node --version
   ddev exec git --version
   ```

7. Install the package inside the theme's Node directory. Pin an exact released
   tag. Before a release, use a separate local package checkout for integration.
8. Run Chromium and the capture command on the host. Use the local DDEV URL as
   the side origin. Install the trusted DDEV certificate on the host if needed.
9. Keep capture settings and target lists in the project. Keep runs and raw
   evidence in ignored directories. Never commit client evidence here.
10. Stop only the isolated project with `ddev stop` in its directory.

Record the DDEV version, Node version, browser version, viewport, settle recipe
and local package revision with the pilot result. A successful synthetic check
does not prove CMS integration. Verify the Drupal pilot and then the WordPress
pilot separately. Do not change the project's live database to create a diff.
Use an isolated code change or the synthetic changed variant instead.
