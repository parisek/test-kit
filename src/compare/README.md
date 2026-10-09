# src/compare

One comparator per artifact kind, normalisers with evidence, the noise floor. Spec sections 6 and 8.

`compareRuns` reads two stored runs and writes a screenshot report. It preserves originals. It rejects incompatible settings and tool versions. It limits manifest and PNG input sizes. The explicit browser integration checks verify repeated captures and a changed target.
