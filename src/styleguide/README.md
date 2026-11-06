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
| `STYLEGUIDE_CATALOGUE_INVALID` | Also: every selected component has `has_styleguide: false`, so no target remains. |
| `STYLEGUIDE_COMPONENT_UNKNOWN` | `include` names a component that the catalogue does not hold. |

`noFixture` lists the IDs with `has_styleguide: false`. Their render page holds no component, so they make no target. Capture sends no request for them. The run manifest (`targetSource.noFixture`), the report (`runs[].noFixture`) and `summary` (`noFixture`) list them as "no fixture". They are not failed targets, so a run whose only gaps are these components reaches `complete`. `include` may name such a component. It is skipped and listed the same way.
A whole-page render is reliable in `self-baseline` and `update` pairs, where both sides have the same frame. Against a live site the styleguide frame can change the box (owner decision on #94, point 4). An optional `selector` is a follow-up.
An entry with no `has_styleguide` key counts as renderable, because an older styleguide omits the key.

`readComponents({ origin, mount, include, get })` calls `get(url)` once, with `{ status, body }` as the result, and parses the body.
`componentsUrl` and `componentPath` build the two URLs. `validMount` checks `mount`.

Two opt-in options add targets (R13.52). Both are off by default, so a catalogue read as before gives the same targets.
`variants: true` reads the `variants` field of each entry (`[{ id, title }]`, `id` matching `[a-z0-9-]+`) and makes one target for each variant. Its ID is `<component>--<variant>`, its title `<name> / <variant title>` and its path `<mount>/render/component/<id>?canvas&variant=<variant>`. With this option an entry whose `has_default_variant` is `false` makes no default target, because the styleguide grid shows no default tile for it. If the entry has no variant either, it is listed in `noFixture`.
`pages: true` passes the parsed `<mount>/api/pages` list (same shape, `[]` allowed). Each page makes a `page` target with ID `page--<id>`, so a page never collides with a component. Its path is `<mount>/render/page/<id>?canvas`. Page variants follow the same rule as `page--<id>--<variant>`. A page with `has_styleguide: false` is listed in `noFixture` as `page--<id>`.
A bad `variants` field, a target ID longer than 64 characters and a repeated target ID throw `STYLEGUIDE_CATALOGUE_INVALID`. The read never skips an entry.
`include` names target IDs. A component ID also selects its variants, and `page--<id>` also selects the variants of a page. A name that matches no target throws `STYLEGUIDE_COMPONENT_UNKNOWN`, also when the option that would make it is off.
`readComponents` sends one GET for the components and, with `pages`, one more for the pages.

Out of scope: `usage` as `composedOf` (R9.5), themes, locales, content checks on a component, the `convergence` pair and a remote styleguide side.
