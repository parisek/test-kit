# Evidenced comparison policy

Rules match every supplied scope axis (R8.4, R8.5).
Literal HTML normalizers inspect original spans. They preserve raw bytes.
Known differences bind one ordered run pair and exact evidence (R5.2, R5.3).
Classification uses one pure per-finding acceptance evaluator (R11.6).

`model.js`, `normalize.js`, and `classify.js` are pure (R4.4).
`normalizeRules` and `normalizeKnown` reject malformed scope and evidence.
`normalizeHtml` applies bounded literal spans from the original strings.
Distinct reserved tokens preserve occurrence count and order. A collision or
an overlap skips that rule with a diagnostic. A residual change stays unexplained.
`findingIsExplained` checks the accepted finding, ordered run IDs, scope,
policy, fingerprint, and associated artifact audit. A known cause alone does not
explain a scoped finding. Legacy unscoped report causes retain their contract.

`evidence.js` reads bounded contained raw sidecars and stored run manifests.
It hashes full bytes and validated effective viewport and tool provenance.
`record.js` verifies report copies, records only complete non-oracle evidence,
and updates configuration through an optimistic atomic rename. It does not
rewrite reports. A new comparison applies the recorded policy (R5.3, R11.5).
Catalog normalization and exact recorded acceptance have separate validators.
