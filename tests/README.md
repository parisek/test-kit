# Tests

`npm test` runs `node --test tests/`. No dependency is needed.

- `unit/`: pure logic and the command line. No browser, no network, no file system outside a temp folder.
- `fixtures/`: small reports and captures for the tests. Fixtures hold sample data only, never a client name, URL or screenshot (specification R12.4).

A test that needs a browser (Playwright) belongs in a later folder, `e2e/`, and runs in its own CI job.
