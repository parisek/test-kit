# src/decisions

Decisions answer layout differences of a design pair (R9.14, R11.9, #350 part C).
The owner sees what changed in the design (a `drift` pair, R3.12) and where the site differs from the design (a `convergence` pair), and decides per difference: `implement` or `report-only`.

| File | Holds | Pure |
| --- | --- | --- |
| `model.js` | The file validator (`normalizeDecisions`), the status of each entry (`decisionsForReport`), the label of a difference (`decisionLabel`), the match for the classifier (`isDecided`), the report validator part and the counts. | yes (R4.4). The viewer bundles it. |
| `fingerprint.js` | `decisionFingerprint`: the hash of the key and the design value. `checkFingerprints`: each entry of a file must carry the hash of its own key and value. | no, it hashes with `node:crypto` through `settingsHash`. |
| `file.js` | Reads `test-kit.decisions.json` and appends an entry through a temporary file and a rename. | no |
| `record.js` | `recordDecision`, the command `record-decision` (R5.3). | no |

## Rules

- The file sits beside the config. There is no config key. `--decisions FILE` overrides the path for `diff` and `record-decision`. A missing file is an empty list. The path must name a regular file. `lstat` refuses a symbolic link, a FIFO, a device and a directory before the open. The open uses `O_NOFOLLOW` and `O_NONBLOCK`, and `fstat` must show the same regular file (dev and ino). So a FIFO cannot hang `diff` or `record-decision`. An invalid file fails the command before any report is written. It never falls back to an empty list.
- The key of a difference is target, viewport, part and property, as the layout difference sidecar names them. The fingerprint hashes the key and the design value. The decision, the reason and the owner stay out of it.
- The design value is the value of run B when run B is a design run (in a drift pair, the later import), else the value of run A. A pair without a design run takes no decision.
- The producer reads the file and decides each status once: `active`, `stale` (the design value moved), `absent` (no difference with the key) or `unchecked` (no complete layout artifact). The status reads the full list of differences of a cell, not only the first 100 that have a finding.
- The classifier reads only `report.decisions`. A layout finding is explained only through an `active` `report-only` entry with the same key and its `designFingerprint`. `implement` labels and never explains. A decided difference stays in the findings.
- `record-decision` adds an entry and never edits one. A second entry for the same difference and the same design value is refused. An entry for a new design value is allowed: the old one goes stale.
- The viewer shows no decision yet. It classifies with the same code (R11.6).
