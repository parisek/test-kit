# ADR 0002: Build the viewer with Vue and Tailwind

Status: accepted by the owner on 2026-10-09.
Requirements: R10.1, R10.5, R10.7, R13.5, R13.28.

The viewer needs reusable views and component tests. The company styleguide uses Vue and Tailwind. The owner selects the same stack for test-kit.

The private `frontend/` package holds Vue 3 single-file components, Vite, Tailwind 4, and component tests. Its lockfile pins the build tools. Frontend development needs Node 22.18 or later. The engine still needs Node 20 or later.

The root package ships the committed `viewer/` build. A git installation needs no build, Vue installation, or frontend network request. CI rebuilds into a temporary directory and compares every file. The server exposes only three fixed viewer files. The bundle includes the same report adapters and classifiers that the CLI uses.

One action dispatcher owns viewer state. Components emit actions. A copied UI contract pins the styleguide source commit, version, licence, and file hashes. The packages do not import each other. Test-kit owns evidence and classification styles.

The initial view follows the prototype pair mapping in R10.5. The viewer cannot record a known difference (R5.3).

Pinia, Vue Router, remote token imports, and a consumer build are left out. The current views need none of them. Source maps are left out of the distributed viewer.
