# Performance

Requirements: R6.4–R6.12.

`core.js` contains browser-safe settings and metric aggregation.
`schema.js` validates structured comparison evidence without Node dependencies.
`plan.js` selects explicit page targets without I/O.
`model.js` contains consent, load, findings and Node provenance hashing.
`runPerformance()` runs only on an explicit request. It uses the optional Lighthouse peer.
Lighthouse 13.5.0 needs Node 22.19 or newer. Other test-kit commands keep Node 20 support.

Each target uses one discarded warmup and 3 to 5 measured audits.
The browser keeps its cache between audits. The result stores each sample, the median and the full range.
The settings hash includes the throttle, form factor, repeat count and browser identity.
A change within the larger observed range is within noise. A budget breach is a finding.
Only `failOnBudget` changes the budget exit code.
`evaluateBudgets()` checks an absolute budget for one complete, nonsuspect run.
This is separate from a comparison between two environments.

The first runner supports loopback HTTP only. HTTPS is unsupported.
For DDEV, use its local HTTP URL if it does not redirect to HTTPS.
A forced browser proxy checks every request. It resolves each allowed host to a loopback address.
It connects to the checked address. It blocks remote redirects, non-GET/HEAD methods, HTTPS tunnels and WebSockets.
Chrome background requests also pass through the proxy and stay blocked.
The captured page request log identifies policy violations in the measured page.
This policy can block page features. Such measurements fail rather than imply a valid result.

The runner refuses high machine load.
Windows does not expose this load value through Node. It needs an explicit suspect-run override. An explicit override marks measurements suspect.
Suspect measurements do not produce a speed comparison.
More than three targets need explicit consent. The error states the measured audit and navigation counts.

Raw JSON and HTML stay in the immutable local run directory.
The report integration must publish summary metrics and safe relative paths only.
It must not put a raw Lighthouse report into `report.json`.
Two environment identifiers must match before comparison. Two tool and settings identities must also match.

Sources checked on 2026-10-09:

- [Official Node usage](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md).
- [Official throttle contract](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md).
- [Official security page](https://github.com/GoogleChrome/lighthouse/security): no published project advisories at the time of review.
- The npm registry reports Lighthouse 13.5.0 with Node `>=22.19`.

A dependency audit of the installed lockfile is a separate required check.
The lack of published project advisories is not a dependency audit.

`compare-artifact.js` copies bounded raw reports and writes small summary and comparison sidecars.
It checks each raw metric against its indexed sample. It checks tool and browser identity.
Each raw report has a 20 MiB copy limit. Each summary or comparison has a 2 MiB limit.
An incompatible pair still has A/B summary evidence and an explicit reason.
The server must serve raw HTML as plain text or as an attachment. It must not execute it.
