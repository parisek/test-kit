# Local history

This area lists local runs and comparison reports (G5, R12.2, R13.1).
It does not capture evidence. It deletes files only for `history --prune --yes` (R12.5).

`scanHistory(local)` reads bounded metadata from `runs/<id>/run.json` and
`reports/<id>/report.json`. An unreadable entry stays in the list.
`renderHistory(data)` escapes metadata before it writes HTML.

`startHistory({ local, root, port })` starts a loopback server.
The default store is `test-kit` under `root` (the working directory by default).
It opens comparison viewers with the package server API.
It returns `{ server, origin, url, close }`.
`close()` closes the history server and all comparison viewers.
SIGINT and SIGTERM also close these servers.

Metadata paths must stay in the local store after symlink resolution.
The server does not expose arbitrary files or accept writes.

`pruneHistory({ local, keep, yes })` (`prune.js`) removes the oldest runs beyond `keep` for each side (R12.5).
`planPrune` and `collectReferences` are pure. Without `yes` the function writes nothing.
It refuses a store without the `.test-kit-viewer` marker, a link in the path, a `runs/` folder that is a link, and a store with a workflow lock.
It keeps a run that a report, the workflow state or a baseline names. It keeps a run with no readable time or side.
It removes only `runs/<id>/` with a safe id and checks the real path again before each removal.
