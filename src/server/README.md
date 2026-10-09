# src/server

`serve({reportPath, port, host})` starts a read-only loopback report server.
It returns `server`, `origin`, and asynchronous `close`. The default port is
assigned by the operating system. The default host is `127.0.0.1`.

Fixed routes serve installed package compiled HTML, JavaScript, and CSS. Shared report logic lives in the bundle.
Report assets require an indexed PNG path and realpath containment. No arbitrary
project files or directory listings are served. See `docs/usage.md`.
