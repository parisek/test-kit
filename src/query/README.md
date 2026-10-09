# src/query

`summary.js` exports the pure `summarizeReport` query. It shares classification
with the viewer. Lists are bounded; aggregate counts cover the full report.
Other section 11 queries remain planned.

artifact.js exports queryArtifact(reportPath, {target, viewport, artifact, maxLines}).
HTML uses a bounded replacement window. HTTP status uses a fixed metadata schema.

The query command returns bounded HTML windows or HTTP metadata (R11.1).
It requires a target, viewport, and artifact. It strips unknown sidecar fields.


Artifact query returns the ordered pair key, at most 50 scoped rules, bounded
rule text and evidence, and an omitted-rule count. Raw and normalized windows
use the same requested display-line cap (R11.6).
