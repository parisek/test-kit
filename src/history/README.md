# Local history

This area lists local runs and comparison reports (G5, R12.2, R13.1).
It does not capture evidence or delete files.

`scanHistory(local)` reads bounded metadata from `runs/<id>/run.json` and
`reports/<id>/report.json`. An unreadable entry stays in the list.
`renderHistory(data)` escapes metadata before it writes HTML.

`startHistory({ local, root, port })` starts a loopback server.
The default store is `.test-kit` under `root` (the working directory by default).
It opens comparison viewers with the package server API.
It returns `{ server, origin, url, close }`.
`close()` closes the history server and all comparison viewers.
SIGINT and SIGTERM also close these servers.

Metadata paths must stay in the local store after symlink resolution.
The server does not expose arbitrary files or accept writes.
