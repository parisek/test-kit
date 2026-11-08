# src/report

Validates report schema version 3 (R9.7 to R9.12) and adapts versions 1 and 2 (R9.1).
`catalog.js` holds the pure constants of the checks catalog: bases, layers, artifact kinds, the six built-in checks and the behavior key `behavior.<contract name>`. The viewer bundles it, so it imports no check module.
A report has exactly one of `pair` and `subject`. The classifier reads the basis of a finding from the catalog: an absolute finding is `explained` only through an active entry of `report.allowlist` (R9.12, `src/allowlist/`). `validateReport` checks that key and the finding `evidenceFingerprint`. An absolute artifact index (`evidence`, `result`) sits at viewport or target scope (R9.9), and `targetState` and `targetClass` read both scopes.
Classification is pure and shared by the viewer and queries (R4.4, R11.6). A layout finding is `explained` only through an active `report-only` entry of `report.decisions` (R9.14, `src/decisions/`). `validateReport` checks that key, the layout finding keys and the pair kind `drift` (R3.12).

`cellState` and `targetState` aggregate every selected artifact, `status` included.
A failed artifact keeps the target incomplete. Availability remains separate.

`artifactState` and `artifactClass` describe the selected artifact. A complete
screenshot or HTML comparison remains readable when a sibling artifact fails.
Findings and recorded acceptance stay scoped to the selected artifact and
viewport. Missing or failed evidence cannot prove a match. Status has no
comparison verdict. Content needs measured checks before it can prove a match.

The legacy screenshot adapter keeps stored cell states when there is no
artifact map. New reports keep their artifact-specific states.
