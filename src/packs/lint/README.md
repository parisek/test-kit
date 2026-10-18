# Lint pack

The lint pack runs ESLint and Stylelint as checks of an opt-in pack. Option C of ADR 0004 sets the model: basis `absolute`, subject `lint` (R7.2, R8.10 to R8.13, R9.7 to R9.11).
The pack runs only when the project selects `lint` in `resolveChecks` (G3, R5.1). Test-kit does not bundle ESLint or Stylelint.

## Parts

| File | Pure | Holds |
| --- | --- | --- |
| `normalize.js` | yes | `normalizeEslint`, `normalizeStylelint`, `judgeRun`, `relativeFile`. They turn recorded JSON into items. |
| `pack.js` | yes | `lintPack`: the checks `eslint-rules` and `stylelint-rules`. Both are `absolute` and apply to the artifact `lint`. |
| `runner.js` | no | `runLint(options)`. It starts the project's own linters and returns the artifact value. |

Entry points: `@parisek/test-kit/packs/lint` (pure) and `@parisek/test-kit/packs/lint/runner` (starts processes).

## Use

```js
import { resolveChecks, runChecks } from '@parisek/test-kit/packs';
import { lintPack } from '@parisek/test-kit/packs/lint';
import { runLint } from '@parisek/test-kit/packs/lint/runner';

const value = await runLint({
  root: process.cwd(),
  tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['src/**/*.css'] } },
  fileTargets: { 'src/components/card/card.js': 'example-card' },
});
const plan = resolveChecks({ available: [lintPack], packs: ['lint'] });
const result = runChecks(plan, { artifact: 'lint', value }, {});
```

A tool left out of `tools` does not run, and its check is `missing`.

## What the artifact stores

Only normalized, relative data. The raw tool output and the absolute project root are not stored.

```json
{
  "fileTargets": { "src/components/card/card.js": "example-card" },
  "tools": {
    "eslint": {
      "status": "ok",
      "version": "9.39.5",
      "items": [{ "severity": "error", "rule": "no-console", "message": "Unexpected console statement.", "location": { "file": "src/app.js", "line": 3, "column": 5 } }],
      "total": 1
    }
  }
}
```

`status` is `ok`, `missing` or `failed`. A `failed` or `missing` entry has a `diagnostic`. `items` holds at most 999 entries. `total` is the real count.
A file path is relative to the project root. A file URL is parsed with the URL class. Only an empty host or `localhost` is local. Percent escapes are decoded. A malformed one, and an encoded separator or NUL (`%2F`, `%5C`, `%00`), is rejected and counts as outside, as in Node's `fileURLToPath`.
A file outside the root (a path with `..` that leaves the root, an absolute path elsewhere, a remote file URL, or a rejected name) is stored as `<outside>/<base name>` with `"outside": true` on the item. The marker is a valid relative path for the stored-data check, but it names no project file. Such an item always maps to `@project`, even when its base name is a key of `fileTargets`. Only in-root files are looked up in `fileTargets`. The pack decides by the `outside` flag only, never by the prefix. A real in-root file in a directory named `<outside>` is an ordinary name and maps by name. A flag that is present and not `true` makes the check `failed`. A name with a colon, such as `a:b.js`, is a legal name and stays. A drive path (`C:/x`) and a URL (`scheme://`) are not names. The runner collapses a symlinked root with `realpath`. The project root (and its realpath) is also removed from message text, so a plugin message does not leak the host path. The root also matches in URL-encoded form and after `file://` or `file://localhost`. A Windows file URL such as `file:///c:/users/me/proj/c.js` matches a drive-letter root, ignoring case. Matching ignores case for a Windows-style root (`C:\proj`) and on darwin and win32 hosts; elsewhere it is case-sensitive. The root matches only at a path start. A separator after it, or a character that cannot continue a name (space, quote, colon, comma, parenthesis, a dot at the end of a sentence), counts as a boundary. A letter, a digit or `_ ~ @ -` after it, or a dot plus such a character, means a sibling name, so it stays: `/srv/example-root2/x.js`, `/srv/example-root-old/x.js` and `/srv/example-root.eslintrc.json` are not changed by the root `/srv/example-root`. The root is a directory, so `root.name` is a sibling, not a file inside it. A sibling path can still leak its text. A filesystem root (`/` or a drive root) is never scrubbed, and `runLint` refuses it with a `failed` artifact. Other absolute paths in a message are not scrubbed.
The check validates the stored data again and fails closed. Only the runner should write it.
`fileTargets` must be a plain object. Each key must be a normalized relative path (no `..`, no `.` segment, not absolute, no drive letter, no URL scheme, no backslash, no trailing slash, no control or bidi character). Each value must be a target id. The key `__proto__`, a symbol key and a non-enumerable key are refused. A bad map makes the check `failed`. The same file rule applies to every stored `location.file`: a traversal or absolute path never gives a complete finding.

## The runner

- It looks for `node_modules/<tool>` in the project root only. With `hoisted: true` it also looks in each parent directory, for a monorepo.
- It runs the `bin` of that package with the current Node, with no shell, in its own process group.
- It runs `<tool> -f json -o <temp file> <paths>` and reads the report from the file. Stylelint writes its report to stderr, so a file is the stable route. It ignores stdout and stderr.
- `paths` are plain relative paths or globs. Allowed characters: letters, digits, `_ @ . / * -`. A path that starts with `-` or `/`, holds `..`, a brace, a comma or a bracket is refused. The runner checks the paths of every tool before it runs any tool.
- The report file must be at most 32 MiB (33554432 bytes, a chosen bound). A larger file is `failed`.
- Timeout: 120000 ms (`timeoutMs`). At the timeout the runner sends SIGTERM to the process group, and SIGKILL after `killGraceMs` (2000 ms). It then resolves after 500 ms even if the process never closes. On every path (timeout, normal exit, crash) the runner also sends SIGKILL to the whole group after the leader ends, so a child that ignores SIGTERM or that the tool left behind after exit 0 does not survive. Before that kill the runner probes the group with `kill(-pid, 0)`. If the probe throws (ESRCH, empty group; or EPERM), nothing is killed, so a reused pid cannot hit an unrelated group. If the probe succeeds, the group still has live members. The kernel cannot hand out a pid while a process group with that id exists, so those members are descendants of the tool, and the runner kills them. A check-then-kill window of microseconds remains. It matters only if the last member exits and the kernel reuses the pid in that time, which is negligible. On Windows the runner calls `taskkill /T /F` on the timeout path only, while the leader is alive. After the leader exits, its pid is dead and Windows may reuse it, so the runner does nothing there, and a child left behind by a tool that exits normally is not cleaned. This is not tested on Windows. The result is `failed` with the signal `TIMEOUT`, and the temp directory is removed. Both times are chosen bounds.
- Windows: the runner calls `taskkill /T /F`. This path is not tested. On POSIX a tool that starts a process in a new session (`setsid`) escapes the group kill.
- Environment: the child gets only `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `SystemRoot`, `LANG`, `LC_ALL`, `NO_COLOR` and `FORCE_COLOR`. No `NODE_*` variable passes, because `NODE_OPTIONS` can preload code and `NODE_PATH`, `NODE_AUTH_TOKEN` and `NODE_TLS_*` change trust. A project adds any of them with the `env` option (string values, plain names). `env` can re-enable `NODE_OPTIONS` and `NODE_PATH`, so it must never come from untrusted project configuration.

## States (R8.7)

| Case | Check state |
| --- | --- |
| Tool not selected | `missing` |
| Tool not installed in the project | `missing` |
| ESLint exit 0 or 1, or Stylelint exit 0 or 2, with matching JSON | `complete`, with the findings |
| ESLint exit 2 (configuration problem, internal error or no matching file) | `failed` |
| Stylelint exit 1 (fatal error, for example no matching file; no report file) | `failed` |
| Stylelint exit 2 with empty `warnings` and an `invalidOptionWarnings` entry | `failed`, with a diagnostic that names the configuration problem |
| Other exit code, signal, timeout, text that is not JSON, or an exit code that contradicts the JSON | `failed` |
| Malformed JSON shape or unknown severity | `failed` |
| More than 999 problems in one tool | `missing`. The list is cut and a marker finding says so. |

Exit code 1 (ESLint) or 2 (Stylelint) with findings is a normal run, not a failed run.
A report with an exit code that contradicts its errors is `failed`: exit 0 with an error, or the problem code with no error.

## Findings

A finding has `severity`, `message`, `location` and `evidence: { tool, rule }` (R9.11). `location` is a top-level field, `{ file, line, column }`, and it is stored once. `rule` is `null` for an ESLint parse error.
ESLint severity 2 is `error` and 1 is `warning`. Stylelint `error` and `warning` map the same way.
The finding has no `viewportId`. Do not set `viewportId` in the context.
`targetId` is `fileTargets[file]` when the caller maps the file to a component id, and the reserved id `@project` otherwise (R9.11). `context.targetId` is not used.
The pack API fixes `checkId` to the check id, so the rule id sits in `evidence.rule`.

## Open or not built

- The `lint` index entry of the report and `settingsHash` (R9.9). Both need `schemaVersion` 3 (R13.9).
- Allowlist `reason` and `owner`, and findings of completed checks in mixed artifacts. Both are open questions of ADR 0004.
- Fix suggestions of the tools. The pack ignores them.

## Sources and verification (2026-10-18)

- ESLint `json` formatter: <https://eslint.org/docs/latest/use/formatters/>. ESLint exit codes: <https://eslint.org/docs/latest/use/command-line-interface>.
- Stylelint result object: <https://stylelint.io/user-guide/node-api/>. Stylelint exit codes and stderr: <https://stylelint.io/user-guide/cli/>.
- The Stylelint pages do not describe the `json` formatter. Its shape comes from the result object and from a real run.
- Real runs: ESLint 9.39.5 and Stylelint 16.26.1 on Node 26.11.0. `eslint-real.json`, `stylelint-real.json` and `stylelint-invalid-option.json` come from those runs, with the project path replaced by `/example-root`. The exit codes in the table above were observed in these runs (ESLint 1 and 2, Stylelint 1 and 2).
- `eslint.json` and `stylelint.json` are hand-written in the documented format.
- Not run: ESLint 8 (legacy config), Stylelint 15 and 17, Windows, and a project with a shared config that prints warnings to the report. Other versions may differ.
