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
A switched-off check has state `missing` and a diagnostic. Missing input is detected first, and an override does not remove that diagnostic. An override outside its scope has no effect (R8.2).

A finding is a plain object with `severity` (`info`, `warning` or `error`), `message` and `evidence` (a plain object), and optionally `targetId`, `viewportId`, `artifact` and `checkId` (R7.2, ADR 0004).
`targetId` falls back to `context.targetId`. A finding with no target is `failed`. A finding that names another artifact or check, carries an unknown key, or has a hole in the list is `failed`.
The caps are 1000 findings, 1000 characters of message, and 10000 characters of evidence as JSON. The caps are chosen safety bounds, not measured numbers.
`runChecks` copies each finding into a frozen plain object (R7.1).
It accepts only a plan from `resolveChecks`. A scope reads own keys only (`targets`, `artifacts`, `kinds`). Any other key makes the override invalid.

Input contract: the stored value and the context are JSON-like data. Allowed: primitives, arrays and plain objects (prototype `Object.prototype` or none). Stored artifacts are JSON sidecars (R9.2, R9.4).
One walk rejects everything else before any check runs: Map, Set, Date, ArrayBuffer, SharedArrayBuffer, typed arrays, DataView, RegExp, Error, class instances, functions, symbols, BigInt, accessors and sparse arrays. The run state is `failed`, each applicable check is `failed`, and the diagnostic names the type and the path, for example `value.items[3] is a Map`.
One function sanitises the output of one check inside that check's try: it validates, copies, round-trips evidence through JSON, requires a plain object, reads `evidence.state` and adds `layer`. A whitespace-only message is invalid. A list with a hole is an error in `definePack` and `resolveChecks`.

Nesting is limited to 256 levels, counted from the wrapper `{ value, context }`, so the value starts at level 1. The walk measures the real height of the graph with one memo per node, in any property order. A node that many paths share is measured once, and shared nodes are allowed.
A cycle is rejected with the path where it closes. JSON-like data has no cycles.
`undefined`, `-0`, `NaN` and `Infinity` are accepted as plain values. The contract is JSON-like, not JSON-exact. The limit is a chosen safety bound, not a measured number. The walk is iterative, so a very deep input fails with the depth message, before the clone, and never overflows the stack.
`runChecks` takes ONE `structuredClone` of the value and the context together, so shared references stay shared (`value.ref === context.ref` holds). It deep-freezes the clone once. All checks get that same frozen snapshot. A write to it throws a `TypeError` and fails that check. The caller's objects are never read again.
Evidence is copied with `structuredClone` before anything else. A `toJSON` hook or a function makes the check `failed`. The state marker is read from that copy.
An open state is exactly `evidence.state` of `incomplete` or `unknown`, in lowercase and unpadded. A value that equals one of them only after `trim()` and `toLowerCase()` makes the check `failed`.
Checks are synchronous (R7.1), so there is no timeout.
An override scope `kinds` list accepts only `single-run` (R8.5).

Rule for all input: the code reads each caller field, list and getter once, validates that copy, and stores only that copy. A getter or Proxy that returns another value on a second read has no effect.
A `state` in evidence must be a string when present. Any other type makes the check `failed`.

Check state is `complete`, `missing` or `failed` (R8.7).
A check that throws, returns a promise or returns a malformed list gives no finding and state `failed`.
A check with no input, a relative check with no `context.before`, a component check with no `context.components`, or a check that reports `evidence.state` of `incomplete` or `unknown` gives `missing`.
An empty plan gives run state `missing`. The run state is `complete` only when every check is complete.

Not built yet: threshold overrides, allowlists (ADR 0004, open question 4), library version detection (R13.42), and the `schemaVersion` 3 report fields (R13.9).
The six built-in content checks in `src/checks` stay as they are. They have no `basis`.

Packs in the package: the accessibility pack (axe) is in `src/packs/a11y/` (`@parisek/test-kit/packs/a11y`).
