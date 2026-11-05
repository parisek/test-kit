# src/compare

One comparator per artifact kind, normalisers with evidence, the noise floor. Spec sections 6 and 8.

`compareRuns` reads two stored runs and writes a screenshot report. It preserves originals. It rejects incompatible settings and tool versions. It limits manifest and PNG input sizes. The explicit browser integration checks verify repeated captures and a changed target.

Response artifacts use bounded sidecars and a linear HTML replacement window.
Requested comparable artifact failures keep measurement incomplete (R8.7).


Comparison takes optional validated rules and pair-scoped known differences.
It retains raw findings and attaches verified evidence acceptance. Policy does not
change screenshot capture hashes. See `src/rules/README.md` (R8.4–R8.6).

`packs.js` reads the pack results that `capture --packs` stored in run B (R13.51). It runs the pack checks over each stored sidecar and writes an absolute artifact index (R9.9), findings and a catalog entry. Only side B enters the report. A run with no stored pack result adds nothing (R5.1).
