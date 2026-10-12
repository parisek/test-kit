# Shared tool UI: first decision proposal

Status: proposed. This audit does not change either released application.

Reference sources:
- styleguide commit `d626d596eece8fe34fc088db4e9a45679123762d`.
- test-kit commit `a47c4c0729fee60e8587c25a69522a785b9fad46`.
- The copied UI token file matches the current styleguide file by SHA-256.

The common tokens do not define typography or component behavior. Both tools
add local styling. Shared colors alone do not produce a shared interface.

| Area | Proposal | Reason |
| --- | --- | --- |
| Font | Shared system font | Both tools use it. No font asset dependency is needed. |
| Type scale | Joint proposal: body/control 14 px, metadata 12 px, title 24 px | Test-kit uses many 8–11 px labels. Styleguide supplies a more readable starting point. Dense results still need their own test. |
| Sidebar | Styleguide light/dark surfaces; test-kit result indicators | A permanent dark sidebar conflicts with the light theme. Result indicators carry test meaning and must remain. |
| Active navigation | Styleguide tinted accent | Reserve strong status colors for evidence. Use an additional indicator so color is not the only cue. |
| Controls | Joint proposal: 36 px desktop, 44 px narrow screen | Styleguide mixes 32 px token controls and 36 px local controls. Choose a predictable size and test touch use. |
| Toolbar | Shared minimum 60 px, allowed to grow | Current token 57 px and test-kit 66 px differ. A fixed height must not clip controls or text. |
| Panels | Joint proposal: 8 px radius | Current 4 px token and local 8–12 px panels differ. Choose one panel role instead of forcing pill shape on every element. |
| States | Test-kit complete/missing/failed/incompatible model | Catalog selection and measurement availability are different concepts. Keep state names and text. |
| History | Same shell primitives as report viewer | Separate inline styling currently creates another visual language. Static export must remain possible. |

## Preview

Open `docs/prototypes/shared-ui.html`. The source samples are styling approximations on the same report task. They
do not reproduce the styleguide catalog or its selection workflow. They are not pixel-identical screenshots. The shared candidate
supports theme and density choices, long target names, filters, and result states.

The sizes above are proposed design values. They are not measured usability gains.

## Rollout

1. Compare the proposal at desktop and narrow widths, in light and dark themes.
2. Record accepted choices in a versioned UI contract. Extend its semantics with
   type, spacing, control, panel, and state roles. Preserve provenance (R13.5).
3. Apply the same primitive examples to both tools. Keep domain behavior local.
4. Migrate test-kit viewer, history, and feedback incrementally. Check long names,
   dense results, keyboard focus, incomplete evidence, and static exports.
5. Add a synchronized reference showcase. Copy the contract; do not create a
   runtime dependency between the packages.

No retention, default checks, or report classifications change in this proposal.

## First verification

The candidate renders at 1280 px and 390 px. The document width equals the
viewport width at both sizes. Theme and density switches update their pressed
states. This is a layout check, not a completed accessibility audit.

## Source and scope limits

- [Styleguide sidebar source](https://github.com/parisek/styleguide/blob/d626d596eece8fe34fc088db4e9a45679123762d/frontend/src/components/Sidebar.vue).
- [Styleguide toolbar source](https://github.com/parisek/styleguide/blob/d626d596eece8fe34fc088db4e9a45679123762d/frontend/src/components/ViewportToolbar.vue).
- [Test-kit chrome source](https://github.com/parisek/test-kit/blob/a47c4c0729fee60e8587c25a69522a785b9fad46/frontend/src/style.css).

Proposed spacing roles are 4, 8, 12, 16, 24, and 32 px. Controls use 12 px
horizontal padding. Normal panels use 24 px; dense panels use 16 px. These
roles are the starting layout scale. The prototype still has role-specific
exceptions, including 6 px vertical control padding. The 12 px horizontal
control padding demonstrates the proposed role. They remain proposals until
scanning and touch use are checked.

Measurement and result are separate columns. Complete evidence can contain a
finding. Failed, missing, and incompatible measurements do not imply a result.

The narrow preview checks filters and the result table. It does not implement
a target drawer. The palette uses local role variables; the copied contract
is unchanged. Keyboard focus, palette contrast, scanning speed, and touch use
are not established by the width check.

## Tailwind implementation boundary

The shared contract uses Tailwind 4 (R10.1, R13.5). It defines semantic theme
tokens and common utility patterns for typography, spacing, surfaces, controls,
and focus. Both packages copy the versioned source contract and record its
licence, source commit, and hashes. Each package builds its own styles.

Keep utility patterns visible in Vue templates. Use complete class names so
Tailwind can detect them. Keep component behavior and test result states in
their own package. Do not copy a compiled stylesheet between repositories.

Test-kit builds the styles for its viewer, static history, and feedback shells
from the same Tailwind source. Its build must include the shell templates in
class detection. The package ships the compiled assets. A project needs no
Tailwind dependency or frontend build (R10.1, R13.28). Static export includes
those assets and keeps relative references (R10.11).

The handwritten CSS in this prototype is a design aid. It is not the shared
implementation. Replace its proposed roles with Tailwind tokens and utility
patterns when the application migration starts. The two packages have no
runtime dependency on each other.
