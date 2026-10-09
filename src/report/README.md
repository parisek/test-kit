# src/report

Validates report schema version 2 and adapts stored reports for the viewer.
Classification is pure and shared by the viewer and queries (R4.4, R11.6).

`cellState` and `targetState` aggregate requested comparable artifacts.
A failed artifact keeps the target incomplete. Availability remains separate.

`artifactState` and `artifactClass` describe the selected artifact. A complete
screenshot or HTML comparison remains readable when a sibling artifact fails.
Findings and recorded acceptance stay scoped to the selected artifact and
viewport. Missing or failed evidence cannot prove a match. Status has no
comparison verdict. Content needs measured checks before it can prove a match.

The legacy screenshot adapter keeps stored cell states when there is no
artifact map. New reports keep their artifact-specific states.
