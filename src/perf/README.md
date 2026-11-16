# Performance

Requirements: R6.4–R6.12.

`core.js` contains browser-safe settings and metric aggregation.
`schema.js` validates structured comparison evidence without Node dependencies.
`plan.js` selects explicit page targets without I/O.
`model.js` contains consent, load, findings and Node provenance hashing.
`runPerformance()` runs only on an explicit request. It uses the optional Lighthouse peer.
Lighthouse 13.6.0 needs Node 22.19 or newer. Other test-kit commands keep Node 20 support.

Each target uses one discarded warmup and 3 to 5 measured audits.
The browser keeps its cache between audits. The result stores each sample, the median and the full range.
The settings hash includes the throttle, form factor, repeat count and browser identity.
A change within the larger observed range is within noise. A budget breach is a finding.
Only `failOnBudget` changes the budget exit code.
`evaluateBudgets()` checks an absolute budget for one complete, nonsuspect run.
This is separate from a comparison between two environments.

The runner measures a local or a remote side over HTTP or HTTPS (R6.16, #383).
It uses no proxy. `isolation.js` builds the Chrome flag `--host-resolver-rules`:
every host resolves to "not found", except the own host and the hosts of `allowOrigins`.
`network.js` checks that a local side resolves only to loopback. The rules pin the own host to that address.
A local HTTPS side passes the public key hash of its own certificate (`--ignore-certificate-errors-spki-list`).
Chrome accepts that one certificate and verifies every other one.
`perfBlockPaths` become Lighthouse `blockedUrlPatterns` of the own origin.
After each audit, `requestEvidence` reads the DevTools log. A blocked request is evidence:
the artifact lists `blocked` groups `{ resourceType, origin, count }` (R6.17).
The comparison detail copies the checked groups of each side (`storedBlocked`), so the viewer and the query show them.
A write method that Chrome sends, a WebSocket, a failed allowed origin, a runtime error or a navigation that leaves the origin fails the target.
A blocked write is evidence too: its failure event shows the block. Chrome sends a request before the runner reads the log, so a write of the own origin or of an `allowOrigins` host that no rule blocks reaches that server once, in the warmup. A failed request of the own origin does not fail the target: the Lighthouse report shows it.
On a remote side, one failed target stops the run.

The runner refuses high machine load.
Windows does not expose this load value through Node. It needs an explicit suspect-run override. An explicit override marks measurements suspect.
Suspect measurements do not produce a speed comparison.
More than three targets need explicit consent. A side with `production: true` needs it for any number of targets (R6.5). The plan of the `perf` command applies that rule. The library export `runPerformance` gets URLs, not a side, so a caller that measures a production site must pass `consent: true` itself. The error states the measured audit and navigation counts.

Raw JSON and HTML stay in the immutable local run directory.
The report integration must publish summary metrics and safe relative paths only.
It must not put a raw Lighthouse report into `report.json`.
Two environment identifiers must match before comparison. Two tool and settings identities must also match.

Sources checked on 2026-10-09:

- [Official Node usage](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md).
- [Official throttle contract](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md).
- [Official security page](https://github.com/GoogleChrome/lighthouse/security): no published project advisories at the time of review.
- The npm registry reports Lighthouse 13.6.0 with Node `>=22.19`.

A dependency audit of the installed lockfile is a separate required check.
The lack of published project advisories is not a dependency audit.

`compare-artifact.js` copies bounded raw reports and writes small summary and comparison sidecars.
It checks each raw metric against its indexed sample. It checks tool and browser identity.
Each raw report has a 20 MiB copy limit. Each summary or comparison has a 2 MiB limit.
An incompatible pair still has A/B summary evidence and an explicit reason.
The server must serve raw HTML as plain text or as an attachment. It must not execute it.

The viewer links each original Lighthouse HTML report from the speed overview
and target detail. Download the HTML and open it locally to use the native
interactive report. Test-kit shows only the A/B comparison summary. It does
not reproduce the Lighthouse audit interface or upload evidence to a service.
The report server keeps raw HTML inert and sends it as an attachment.
