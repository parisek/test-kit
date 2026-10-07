# Prototype

This branch holds a working prototype of the report viewer. It is a starting point for `test-kit`, not the package.

- `viewer-app/`: plain ES modules, CSS layers, no bundler. 62 unit tests (`npm test` inside the folder).
- All data is sample data. No capture runner writes it yet. The adapter for `report.json` of `build-report.js` is not tested on a real report.
- The specification is in [portadesign/tailwind-base#873](https://github.com/portadesign/tailwind-base/issues/873).

Do not merge this branch into `main`. `main` stays a placeholder until the plan starts.
