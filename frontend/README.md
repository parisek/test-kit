# Viewer development

Requirements: R10.1, R10.7, R13.5, R13.28.

Use Node 22.18 or later. The engine still supports Node 20.

```sh
npm ci --prefix frontend
npm run test:viewer
npm run build:viewer
npm run check:viewer
```

Commit source and the `viewer/` build together. Do not edit the build by hand. Unit tests for the engine stay browser-free.

`ui-contract/` copies the application chrome tokens from `parisek/styleguide`. `provenance.json` pins their commit, version, and SHA-256 hashes. The MIT licence stays with the copy. To sync, copy the declared files from a reviewed upstream commit, update the provenance, run the checks, and review light and dark themes. Record local deviations in `localChanges`. There are none in this version.

The token contract covers application chrome. Evidence states and finding classes belong to test-kit. Neither package imports the other.
