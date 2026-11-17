# src/cli

The command line and the exit codes. One table of commands. Spec section 4, section 11.

Commands are capture, import, diff, summary and serve. Help lists their flags.
Capture and diff default to `test-kit.config.json` in the working directory.
Diff requires an explicit output directory, relative to the config directory.
Summary and serve accept an explicit report path.

Exit 0 means the operation succeeds. Exit 1 means invalid arguments, an
operational error or a partial capture. Pixel ratios do not change exit codes.
Output is JSON. Errors go to stderr. The binary reads its package version.
Dependencies load only when dispatch runs the selected command.

`capture --packs` (R13.51) is a flag without a value. It runs the packs of the `packs` key on the open page. The output adds `packs` (`selected`, `skipped`) when the flag is set. See `src/capture/README.md`.
`capture --retries N` (R5.14) takes an integer from 0 to 2 (default 0). It tries a failed cell again, only for a transient error (`src/capture/retry.js`). `run`, `before` and `after` do not take it.
`capture --keep-existing` (R5.13) is a flag without a value. It needs a side with `remote: true`. It copies a capture from an earlier complete run when it is provably the same capture (`src/capture/keep.js`). The output adds `kept` (a count) above zero. There is no FORCE. `run`, `before` and `after` do not take it.

`record-decision REPORT --target --viewport --part --property --decision implement|report-only --reason --owner` (R9.14) adds one entry to `test-kit.decisions.json`. `diff --decisions FILE` reads another file. `diff --kind drift` takes two design runs of one design side, the earlier import first (R3.12). See `src/decisions/README.md`.

`import --side <id>` (R4.6) imports the supplied images of a design side into a run. It takes `--config`, `--label`, `--target` and `--viewport`, prints one line with `id`, `state`, `images` and `manifestPath`, and opens no browser and no network connection. See `src/design/README.md`.
