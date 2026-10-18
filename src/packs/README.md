# Packs

A pack is a named, opt-in set of checks. The entry point is `@parisek/test-kit/packs` (R13.42).
Nothing here runs by default. A project must select each pack (G3, R5.1).
All files are pure. They have no DOM and no file system access (R4.4).

- `definePack({ id, title, owner, checks })` validates a pack. Each check exports `id`, `title`, `basis`, `applies` and `check` (R7.2, R8.10).
- `resolveChecks({ available, packs, custom, overrides })` builds a plan. It rejects unknown packs, duplicate ids and bad overrides. It runs nothing.
- `runChecks(plan, { artifact, value }, context)` runs the plan over one stored artifact.

Layers are `package`, `project`, `component` and `page`.
A pack check has layer `package`. A custom check has layer `project`, `component` or `page` and the same shape as a pack check.
A component check declares `applies.components` and runs when `context.components` lists one of them.
Every finding gets `layer` and `checkId`. The layer is the layer of the check that fired (ADR 0004, section 4).
Check ids are unique across all layers. A narrower layer cannot replace a broader check.

A narrower layer may switch a check off with an override: `checkId`, `layer`, `reason`, `owner` and an optional `scope` (`targets`, `artifacts`, `kinds`; R8.5, R8.13).
A switched-off check has state `missing` and a diagnostic. An override outside its scope has no effect (R8.2).

Check state is `complete`, `missing` or `failed` (R8.7).
A check that throws, returns a promise or returns a malformed list gives no finding and state `failed`.
A check with no input, a relative check with no `context.before`, or a check that reports `evidence.state` of `incomplete` or `unknown` gives `missing`.
An empty plan gives run state `missing`. The run state is `complete` only when every check is complete.

Not built yet: threshold overrides, allowlists (ADR 0004, open question 4), library version detection (R13.42), and the `schemaVersion` 3 report fields (R13.9).
The six built-in content checks in `src/checks` stay as they are. They have no `basis`.
