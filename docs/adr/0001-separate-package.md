# 0001. A separate package, public from the first commit

## Context

The visual tooling lives as about twenty files in the `tailwind-base` skeleton manifest. Each project holds a copy, and each derived skeleton holds a copy of that copy. A fix is a sync into every project. The planned tool adds an engine, a viewer, checks and a query interface, and the owner wants the rest of the testing infrastructure to move over in steps. Copies would drift faster than the tool grows.

Three places were possible. Skeleton files keep the drift. `parisek/styleguide` is a Composer package in PHP with a Vue viewer and no Node in production, and the engine needs Node, Playwright and Lighthouse. A separate package has none of those limits.

## Decision

`test-kit` is its own repository and its own Node package. It is public from the first commit. A project installs it as a dev dependency and keeps only configuration, targets and its own checks. `tailwind-base` keeps the doctrine and thin command aliases.

The styleguide stays the source of component data. The two link to each other and share no code (specification R13.3 and R13.4).

PHP lint rules are not part of this package. They go to `parisek/lint-kit`.

## Consequences

- One copy for each version. A project pins a tag and updates with `npm install -D github:parisek/test-kit#vX.Y.Z`.
- A new repository to maintain. The package is not on the npm registry: it is a git dependency from tags (specification section 13.2). A tag never moves.
- Everything is public from the first commit, so no client data may enter the history (R12.4). A leak needs a history rewrite.
- `verify-skeleton` and `sync-skeleton` must learn the new state before the first move (R13.10).
