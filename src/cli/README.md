# src/cli

The command line and the exit codes. One table of commands. Spec section 4, section 11.

Commands are capture, diff, summary and serve. Help lists their flags.
Capture and diff default to `test-kit.config.json` in the working directory.
Diff requires an explicit output directory, relative to the config directory.
Summary and serve accept an explicit report path.

Exit 0 means the operation succeeds. Exit 1 means invalid arguments, an
operational error or a partial capture. Pixel ratios do not change exit codes.
Output is JSON. Errors go to stderr. The binary reads its package version.
Dependencies load only when dispatch runs the selected command.
