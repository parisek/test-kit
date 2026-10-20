# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a developer who receives a link to one finding. The link comes from an agent, a task or a colleague. The developer opens the finding, reads the evidence and decides what to do with it. A project lead who checks the state of the latest run is a secondary reader. An agent is the second reader of the same facts through bounded JSON (vision, "Two readers"). The viewer is for people. The agent does not use it.

## Product Purpose

`test-kit` answers one question: what is different between side A and side B, and is each difference explained (specification section 1). The viewer shows the evidence for that answer. Success: a developer opens a link and sees the same view as the sender, and knows in one minute whether a finding needs a fix.

## Positioning

The tool measures and reports. It does not gate and does not fix (N1, N4). A missing, failed or incompatible measurement never becomes a pass (principle 1). The viewer states what it could not measure.

## Operating Context

- A project runs `before` and `after` around a change. The package writes data to a local store.
- `history --publish DIR` writes a stable static directory. The viewer in it reads `index.json` and `report.json` (R10.12, R10.13). The default is local and git-ignored. Captured pages can hold client data, so sharing is a project decision (vision, "Static first").
- The viewer loads under any URL prefix, from any static host. ADR 0005 assumes that a `file://` URL does not work (not verified).
- The owner and the developer read the viewer in a desktop browser. A phone is possible but not the main case.

## Capabilities and Constraints

- One result, two readers: the viewer and the query interface use the same classification code (R11.6).
- Report data is untrusted. Text goes in as text. A URL attribute stays on the page origin.
- Decisions a developer makes on a finding: fix it; mark it as a known difference with a cause and a reason (the `record-known` command exists; recording must stay a command, R5.3, R11.5); pass it on with a link or an evidence bundle (issue #149). The owner also named "mark as noise or unstable". The viewer has no such action today. A noise floor is measured per pair (R8.3). What the action stores is undecided.
- A deep link to a finding with its view state is wanted: report, target, viewport, artifact and mode. It does not exist today. The URL holds only `#r-<id>`.
- Terms in use: unexplained, explained, match, incomplete (verdict counts); baseline (A) and compared run (B); noise floor; known difference.

## Brand Commitments

The name is `test kit`. The viewer shows a `tk` mark. No other identity commitment is recorded.

## Evidence on Hand

Sample data comes from `example-site` only. This repository is public: no client name, URL or screenshot (R12.4). Real screenshots of a client site are never evidence in this repository.

## Product Principles

These are viewer principles V1 to V4. They refine the numbered principles of `docs/vision.md`. They do not replace them.

- V1. Honest evidence first: show the gap before the pass (vision principle 1).
- V2. One finding, one link: any finding is reachable and reproducible from a URL.
- V3. Evidence, not verdict: the viewer measures and informs. The person decides (vision principle 3).
- V4. The same facts for the agent and the person: nothing exists only in the viewer (vision principle 2).

## Accessibility & Inclusion

Keyboard operation, a named control for every action and WCAG AA contrast. Color never carries a verdict alone. The viewer has a light and a dark theme with a toggle (today the choice sits in the browser storage and defaults to light). Following the system theme is a target, not a fact today.
