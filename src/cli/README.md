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

`import --side <id>` (R4.6) imports the supplied images of a design side into a run. It takes `--config`, `--label`, `--target` and `--viewport`, prints one line with `id`, `state`, `images` and `manifestPath`, and opens no browser and no network connection. See `src/design/README.md`.
