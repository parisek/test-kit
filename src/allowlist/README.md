# src/allowlist

The allowlist explains absolute findings (R9.12, ADR 0004 questions 3 and 4, issue #254).
A relative finding uses `known_diffs` (R5.3). An absolute finding has no pair, so it uses this area.

| File | Holds | Pure |
| --- | --- | --- |
| `model.js` | The file validator (`normalizeAllowlist`), the status of each entry (`allowlistForReport`), the report validator part, the match for the classifier (`isAllowlisted`) and the counts. | yes (R4.4). The viewer bundles it. |
| `fingerprint.js` | `absoluteFingerprints`: the descriptor, the canonical form and the hash of one absolute finding. | no, it hashes with `node:crypto` through `settingsHash`. |
| `file.js` | Reads `test-kit.allowlist.json` and appends an entry through a temporary file and a rename. | no |
| `record.js` | `recordAllowed`, the command `record-allowed` (R5.3). | no |

## Rules

- The file sits beside the config. There is no config key. `--allowlist FILE` overrides the path. A missing file is an empty list. An invalid file fails the command before any report is written. It never falls back to an empty list.
- The producer reads the file and the clock. The classifier reads only `report.allowlist`. Only an entry with status `active` explains a finding.
- The fingerprint hashes one finding of one run: check, target, viewport, artifact, message, evidence and an occurrence number. It holds no run id. Depth limit 8, size limit 64 KB. A value that cannot be hashed gives no fingerprint and a `diagnostic` on the finding. The finding stays `unexplained`.
- A check author puts only values read from the page or the file into `evidence`. Not a time, a run id, a store path, a count that depends on capture order or a random value.
- An entry is `stale` only when every artifact index that selects the check on the target is `complete` and no finding has the fingerprint. A gap in one viewport gives `unchecked`, because an entry names no viewport.
- `record-allowed` trusts the fingerprint in the report. A wrong value gives an entry that matches no finding, so it ends `stale`. It cannot explain a finding it does not match.
