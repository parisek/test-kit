# Local screenshot workflow

Requirements: R4.1, R11.1–R11.6, R12.4.
Configure local sides and an explicit target list in `test-kit.config.json`.
The configuration resolves paths from its own directory. Keep runs outside git.
Use Chromium on the host to visit the local DDEV origin. Install the package in
the project container. Flush pending file synchronization before capture.

Capture the baseline before a change. Capture the current state after it.
Compare the stored runs. No comparison command visits the site again.

```sh
test-kit capture --side local --label before
test-kit capture --side local --label after
test-kit diff <run-a> <run-b> --output tests/visual/report
test-kit summary <report.json> --filter all --max-targets 20
test-kit serve <report.json>
```

The CLI prints run IDs and output paths. Use those paths in later commands.
The viewer and summary use the same classifier. A matching screenshot can have
an HTTP availability error. Incomplete or incompatible evidence is reported
separately. Fix capture errors before interpreting the comparison.

Summary limits target lists, not aggregate counts. Each list records omissions.
Use `--filter unexplained`, `--filter incomplete`, or `--target <id>` to narrow
output. `--max-targets` accepts integers from 1 to 1000. `next` suggests a
supported follow-up. No known difference is accepted through the viewer.

The report server binds to loopback. It serves a fixed viewer shell, shared
classification modules, the chosen report, and PNG paths indexed by that report.
PNG files must reside inside the report directory. It does not list directories
or expose project configuration, arbitrary JSON, or files outside that directory.
Only GET and HEAD are supported. Each served file has a 80,000,000 byte size limit.
Stop the command after review. Client evidence stays local.
