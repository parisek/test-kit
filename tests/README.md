# Tests

`npm test` runs `node --test`, which finds every `*.test.js` file. A directory argument (`node --test tests/`) works on Node 20 and breaks on Node 22, so the script uses none. No dependency is needed.

- `unit/`: pure logic and the command line. No browser, no network, no file system outside a temp folder.
- `fixtures/`: small reports and captures for the tests. Fixtures hold sample data only, never a client name, URL or screenshot (specification R12.4).

A test that needs a browser (Playwright) belongs in a later folder, `e2e/`, and runs in its own CI job.

Run node tests/integration/check-response-artifacts.mjs for the local HTML/status slice.
