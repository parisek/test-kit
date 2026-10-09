# src/compare

One comparator per artifact kind, normalisers with evidence, the noise floor. Spec sections 6 and 8.

`compareRuns` reads two stored runs and writes a screenshot report. It preserves originals. It rejects incompatible settings and tool versions. It limits manifest and PNG input sizes. The explicit browser integration checks verify repeated captures and a changed target.

Response artifacts use bounded sidecars and a linear HTML replacement window.
Requested comparable artifact failures keep measurement incomplete (R8.7).


Comparison takes optional validated rules and pair-scoped known differences.
It retains raw findings and attaches verified evidence acceptance. Policy does not
change screenshot capture hashes. See `src/rules/README.md` (R8.4–R8.6).
