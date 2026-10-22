# Viewer workflow and navigation map

Status: design authority for issue #148. The specification adopts the decided rules through R10.3 to R10.5, R10.10 and R10.13 to R10.15. It is not yet the state of `frontend/`; implementation follows in issue #148. A change to a rule or a path in this file is Tier 3. A record of an approved decision is Tier 1 (`docs/vision.md`, Design authority, rule 6). It serves principles 1, 2 and 3 of `docs/vision.md` (V1 to V4 in `PRODUCT.md`) and R10.1, R10.11, R10.13. Sample data comes from `example-site`.

## Who uses the viewer

| Reader | Situation | Job | What goes wrong today |
| --- | --- | --- | --- |
| Developer (primary) | Gets a link from an agent, a task or a colleague. Opens it in a desktop browser. | See the exact finding. Decide: fix, mark as a known difference, mark as noise, pass it on. | The link opens a report, not the finding. The report title is always "before → after". The capture date sits inside a closed "Capture details". |
| Project lead (secondary) | Opens the home to check the state of the latest run. | Answer "is the latest run clean, and what changed since the last one?" | The list has no verdicts. The answer needs two reports opened. |
| Agent | Reads bounded JSON (`summary`, `query`, `report.json`). | Find a difference, verify it, fix it, measure again. | Not a viewer user. The viewer must not change this interface. |

## Entry points

1. **Finding link.** The developer opens a link to one finding. The page shows that finding with the same view state as the sender. This is the main entry.
2. **Report link.** A link to one comparison opens its Overview.
3. **Directory root.** The publish directory opens the Home (history of comparisons).
4. **Viewer with no data.** The viewer loads the adjacent `report.json` first. It reads `index.json` only when `report.json` is missing: HTTP 404, or HTTP 2xx with an HTML body (R10.10, R10.13). When both are missing, it shows an empty state, "Open a report", with the source form of R10.10. This is the only place that asks for a file or a URL. A viewer copy with an adjacent `report.json` (a `report --export` directory) opens that report directly and has no Home.

## Map

```mermaid
flowchart TD
  F[Finding link] --> EV
  R[Report link] --> OV
  D[Directory root] --> HOME
  S[Viewer with no data] --> OPEN[Open a report]
  OPEN --> OV

  HOME[Home: history of comparisons] -->|open a row| OV
  OV[Report: Overview] -->|open a page cell| EV
  OV --> FD[Report: Findings]
  OV --> RI[Report: Run info]
  FD -->|open a finding| EV
  EV[Report: Evidence for one finding] -->|change viewport, artifact, mode| EV
  EV -->|copy link, copy command, copy bundle| DEC[Decision actions]

  OV -->|breadcrumb| HOME
  FD -->|breadcrumb| HOME
  RI -->|breadcrumb| HOME
  EV -->|breadcrumb: Overview| OV
  OV -->|older or newer| OV
```

## Rules for every path

- One way home: the breadcrumb, always first in the content column. A viewer copy with an adjacent `report.json` has no Home item.
- One way sideways: older and newer comparison, in time order.
- One way up: from Evidence, the breadcrumb returns to the Overview.
- Browser Back steps through views. A view change adds a history entry.
- The app never changes the active view without saying why.

## Decision actions

On a finding the page shows four labelled actions: Fix (copy the link), Known difference (copy the command), Noise or unstable (copy a re-capture command) and Pass on (copy the link). Decided by the owner on 2026-10-20 (#153, D15).

The viewer is a static application. It cannot run a command or write a file. A decision action therefore produces text for the person to use:

| Decision | What the viewer offers | What exists today |
| --- | --- | --- |
| Fix | Copy the link. The task or the agent gets the same view. | The link holds only `#r-<id>`. |
| Known difference | Copy the command `test-kit record-known REPORT --config FILE --target ID --viewport ID --artifact screenshot|html|content --cause ID --reason TEXT`. The viewer fills in the report, target, viewport and artifact. `--config`, `--cause` and `--reason` stay placeholders. The person adds them and runs the command. R5.3 and R11.5 say recording must not be a viewer action: copying text does not record anything. Decided by the owner on 2026-10-22. | The command exists. The viewer does not build it. |
| Noise or unstable | Copy the command `test-kit run --config FILE --target ID --viewport ID` with the target and viewport filled in. The person runs it and sees whether the difference stays. Nothing is stored. A stored noise mark is not part of 1.0. Decided by the owner on 2026-10-22. | The command exists. The viewer does not build it. |
| Pass on | Copy the link. Later: an evidence bundle (issue #149). | None. |

## Deep link grammar (R10.14)

`#r-<report id>/<view>/<target id>/<viewport id>/<artifact>/<finding id>?mode=<mode>`

Each part is percent-encoded. In an export with an adjacent `report.json` the `r-<report id>` part is dropped.

- `view`: `overview`, `evidence`, `findings`, `info`.
- A missing or empty part takes the first valid value for its position. The report id must pass `validId`. The viewer matches target, viewport and finding ids against the open report, so the reserved target id `@project` is valid. A present but unknown part shows a message and opens the Overview of that report. A finding id selects the first finding with that id in report order (report data is untrusted).
- The hash stays under the page origin. It never carries a URL.

## Decided points

The owner decided these on 2026-10-22:

- "Noise or unstable" copies a re-capture command. It stores nothing.
- The viewer builds the `record-known` command text (see the table above).
- Content and Speed are evidence types of the Evidence view (R10.4, issue #155).
- Any future change to the adopted view set or the deep link grammar needs a new owner decision and a specification change.
