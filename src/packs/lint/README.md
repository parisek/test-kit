# Lint pack

The lint pack runs ESLint and Stylelint as checks of an opt-in pack. Option C of ADR 0004 sets the model: basis `absolute`, subject `lint` (R7.2, R8.10 to R8.13, R9.7 to R9.11).
The pack runs only when the project selects `lint` in `resolveChecks` (G3, R5.1). Test-kit does not bundle ESLint or Stylelint.

## Parts

| File | Pure | Holds |
| --- | --- | --- |
| `normalize.js` | yes | `normalizeEslint`, `normalizeStylelint`, `judgeRun`. They turn recorded JSON into findings. |
| `pack.js` | yes | `lintPack`: the checks `eslint-rules` and `stylelint-rules`. Both are `absolute` and apply to the artifact `lint`. |
| `runner.js` | no | `runLint({ root, tools })`. It starts the project's own linters and returns the artifact value. |

Entry points: `@parisek/test-kit/packs/lint` (pure) and `@parisek/test-kit/packs/lint/runner` (starts processes).

## Use

```js
import { resolveChecks, runChecks } from '@parisek/test-kit/packs';
import { lintPack } from '@parisek/test-kit/packs/lint';
import { runLint } from '@parisek/test-kit/packs/lint/runner';

const value = await runLint({ root: process.cwd(), tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['src'] } } });
const plan = resolveChecks({ available: [lintPack], packs: ['lint'] });
const result = runChecks(plan, { artifact: 'lint', value }, {});
```

A tool left out of `tools` does not run, and its check is `missing`.

## The artifact value

```json
{ "root": "/path/to/project", "tools": { "eslint": { "status": "ok", "version": "9.0.0", "output": [] } } }
```

`status` is `ok`, `missing` or `failed`. Only the runner writes it. `output` is the parsed JSON of the tool.

## The runner

- It finds `node_modules/<tool>` from `root` upward, as Node does. It runs the `bin` of that package with the current Node. It uses no shell.
- It runs `<tool> -f json -o <temp file> <paths>`. It reads the report from the file, not from stdout or stderr. Stylelint writes its report to stderr, so a file is the stable route. The temp directory is removed after the run.
- `paths` are plain relative paths or globs. A path that starts with `-` or `/`, holds `..` or holds other characters is refused.
- The timeout is 120000 ms, a chosen bound.

## States (R8.7)

| Case | Check state |
| --- | --- |
| Tool not selected | `missing` |
| Tool not installed in the project | `missing` |
| Exit code 0, or ESLint 1, or Stylelint 2, with matching JSON | `complete`, with the findings |
| Other exit code, signal, timeout, text that is not JSON, or an exit code that contradicts the JSON | `failed` |
| Malformed JSON shape, unknown severity, Stylelint invalid option | `failed` |
| More than 999 problems in one tool | `missing`. The list is cut and a marker finding says so. |

Exit code 1 (ESLint) or 2 (Stylelint) with findings is a normal run, not a failed run.
A report with an exit code that contradicts its errors is `failed`: exit 0 with an error, or the problem code with no error.

## Findings

A finding has `severity`, `message` and `evidence`: `{ tool, rule, location }`. `location` is `{ file, line, column }` (R9.11). `rule` is `null` for an ESLint parse error.
ESLint severity 2 is `error` and 1 is `warning`. Stylelint `error` and `warning` map the same way.
The file is relative to `root`. A file outside `root` keeps only its base name, so no host path enters a finding.
The finding has no `viewportId`. Do not set `viewportId` in the context.
`targetId` is `context.targetId`, or the reserved id `@project`. The pack API requires `checkId` to equal the check id, so the rule id sits in `evidence.rule` and not in `checkId`.

## Open or not built

- Mapping a file to a component target. The caller sets `context.targetId` today.
- The `lint` index entry of the report and `settingsHash` (R9.9). Both need `schemaVersion` 3 (R13.9).
- Allowlist `reason` and `owner`, and findings of completed checks in mixed artifacts. Both are open questions of ADR 0004.
- Fix suggestions of the tools. The pack ignores them.

## Sources checked on 2026-10-18

- ESLint `json` formatter: <https://eslint.org/docs/latest/use/formatters/>. ESLint exit codes: <https://eslint.org/docs/latest/use/command-line-interface>.
- Stylelint result object: <https://stylelint.io/user-guide/node-api/>. Stylelint exit codes and stderr: <https://stylelint.io/user-guide/cli/>.

The Stylelint pages do not describe the `json` formatter. The shape in `tests/fixtures/lint/stylelint.json` follows the documented result object (`source`, `errored`, `warnings`, `invalidOptionWarnings`). The fixtures are hand-written in the documented format. No real ESLint or Stylelint run produced them.
