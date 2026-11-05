# src/styleguide

Reads component targets from a styleguide catalogue. Spec R13.3 and R13.52 (issue #94).

The module is pure (R4.4). It has no file system, no network and no DOM. `capture` passes the transport.
The package reads JSON only. It has no dependency on the styleguide code (R13.4, R13.5).

`parseComponents(payload, { mount, include })` turns the parsed `<mount>/api/components` array into `{ targets, noFixture }`.
Each target is `{ id, kind: 'component', title, path }`. The `id` is the component `id`. The `title` is `name`, or the `id` when `name` is not bounded text. The `path` is `<mount>/render/component/<id>?canvas`.
Targets sort by `id`, so the order does not follow the catalogue weight.
It throws a `StyleguideError` with a code and never skips an entry:

| Code | Cause |
| --- | --- |
| `STYLEGUIDE_CATALOGUE_UNREACHABLE` | The GET fails, answers a status other than 200, or redirects. |
| `STYLEGUIDE_CATALOGUE_INVALID` | Not JSON, larger than 8 MiB, not an array, empty, more than 1000 entries, an entry with an unsafe or repeated ID. |
| `STYLEGUIDE_COMPONENT_UNKNOWN` | `include` names a component that the catalogue does not hold. |

`noFixture` lists the IDs with `has_styleguide: false`. Their render page holds no component. Capture keeps them as targets and fails each capture with `STYLEGUIDE_NO_FIXTURE`, so a blank image never reads as a measurement.
An entry with no `has_styleguide` key counts as renderable, because an older styleguide omits the key.

`readComponents({ origin, mount, include, get })` calls `get(url)` once, with `{ status, body }` as the result, and parses the body.
`componentsUrl` and `componentPath` build the two URLs. `validMount` checks `mount`.

Out of scope: `usage` as `composedOf` (R9.5), variants (`?variant=`), themes, locales, content checks on a component, the `convergence` pair and a remote styleguide side.
