# Behavior engine

This opt-in engine implements R6.2, R6.3 and the contract seam of R13.41–R13.43.
It does not import component contracts from another package.

A contract exports `name`, `detect(page)` and `run(page, instance)`.
It can export `runScoping`, `projects`, `emulate`, `eagerImages` and `library`.
A module can export several contract objects.
`loadProjectContracts(directory)` reads sorted `*.contract.js` project files.
The loader executes trusted project code. It does not load report code.

`runBehavior(options)` receives an existing navigated Playwright page.
The capture owner must install its local-origin GET/HEAD request guard before navigation.
It must apply contract media and image settings before navigation.
The engine reports incompatible pre-navigation settings instead of ignoring them.
The caller supplies the Playwright project name and installed library versions.
`contractFingerprints` can bind each contract name to a SHA-256 module graph hash.
Function source hashing alone does not bind imported helpers.

Each detection, instance and isolation pass is a step.
Missing markers produce a skipped step. A detector error produces a failed step.
Failures retain results and bounded console, response and dataLayer evidence.
Screenshots and optional traces stay in the supplied local artifact directory.
A timeout closes the context to stop an unfinished contract.
The caller must not reuse that context after the timeout.

`compareBehavior(a, b)` is pure. It aligns steps by id.
It rejects different tool versions or settings hashes.
Raw screenshots, durations and network events do not determine equality.
A contract can return a bounded JSON result to compare its asserted end state.

This slice does not replace the legacy Playwright config, componentSpec fixture,
coverage gate or reporter. Project selection and allowlist matching stay with
those owners. Component-specific allowlists remain in component contracts.

## Capture integration

Select `behavior` explicitly in the artifact list.
A minimal project setting names a trusted `source` directory and `lockfile`.
The directory contains contract modules and their relative JS helpers.
Use a common ancestor when contracts import shared helpers.
The loader hashes all JS, MJS, CJS and JSON files in that tree and the lockfile.
It rejects source escapes, symbolic links and excessive source size.
It returns contracts, contract fingerprints and bound library versions.
Changed imports require a new process to avoid Node module cache ambiguity.
Computed imports and runtime file reads remain trusted project code.
Projects must include their input files in the source tree.

Capture supplies a project name for each viewport.
Use the upstream names `desktop-1280` and `mobile-390` when the contracts use
the default project list. Other viewport names need an explicit project map.
Capture records passive artifacts before contracts change the page.
It invokes `runBehavior` with `behavior/<target>/<viewport>` evidence paths.

`compareBehaviorArtifact` copies safe local evidence into the served report.
It retains available failed steps when one side is incomplete.
It writes a behavior comparison sidecar and compact artifact index.
Incompatible browser, viewport or contract settings produce no regression claim.
