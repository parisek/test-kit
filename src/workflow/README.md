# Local workflow

The workflow composes capture, comparison, and the report server (R4.1, R13.1).
Projects provide a configuration file and contracts. They do not copy a runner.

`run` captures one selection. It does not fabricate a comparison.
`before` records a complete baseline for that selection.
`after` compares a new capture with its matching baseline. A partial capture stays on disk and produces an incomplete report.
`report` serves the last comparison or an explicit report ID.

The default store is `.test-kit/` beside the configuration file. Add it to the project git ignore file. It contains `runs/`, `reports/`, and `state.json`. There is no automatic retention policy.

`--target`, `--path`, `--viewport`, and `--suite` select a scope.
`--selector` supports the visual suite and one target only.
`--checks` selects content check IDs. `--contracts` selects behavior contract names.
Use `none` to disable checks or contracts for one invocation.

Each baseline binds its selected settings, side, origin, package lock, and behavior source fingerprint. A change requires a new baseline. A failed baseline does not replace a complete baseline. Capture writes a unique temporary configuration beside the source configuration. Relative source paths remain valid. A store lock rejects concurrent writers. After a crashed process, remove the lock only after that process stops.

`--ddev` explicitly discovers the current loopback HTTP origin. It does not run DDEV commands unless requested. Run the workflow on the host with DDEV already started.
