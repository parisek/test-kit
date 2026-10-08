# Contributing to test-kit

## Run the tests

```bash
npm test
```

The suite needs Node 20 or newer and nothing else. CI runs it on Node 20 and 22.

## Add a test

Put a pure-logic test in `tests/unit/`. Name the file after the module. Use `node:test` and `node:assert/strict`. A test that needs a browser is not a unit test and waits for the `e2e/` folder.

## Add an artifact or a check

Both are files that follow a contract (specification sections 6 and 7). Read the README of `src/compare/` or `src/checks/` first. Do not edit the core to make room for a new one. If the contract is too narrow, change the contract in a separate pull request.

## Open a pull request

1. Branch from `main`.
2. Make one logical change. Keep commits small and focused.
3. Open a draft pull request assigned to `parisek`. Use a Conventional Commit as the title.
4. Wait for CI. Fix a failure or explain it.
5. The owner reviews and merges.

## Public repository

Anything you write here is public. Do not put a client name, a client URL, a screenshot of a client site or a real report in code, tests, issues or pull requests. Use sample data.
