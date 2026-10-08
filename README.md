# test-kit

Status: **early scaffold**. The command line starts and lists the planned commands. Nothing else is built yet.

A tool for testing and comparing a site: pairs of runs, pluggable checks, one viewer, one query interface for agents.
It takes over the testing tools of `tailwind-base` step by step.

- Specification: [`docs/specification.md`](docs/specification.md), kept in step with [portadesign/tailwind-base#873](https://github.com/portadesign/tailwind-base/issues/873).
- Plan: specification section 14. One pull request for each step.
- Decision record: [`docs/adr/`](docs/adr/).
- Viewer prototype: branch `prototype/viewer-app`.

```bash
npm test                      # node --test, no dependency
node bin/cli.js --help
```

Install in a project, from a git tag (no npm registry; see [`RELEASING.md`](RELEASING.md)). No tag exists yet:

```bash
ddev npm install -D github:parisek/test-kit#v0.2.0
```

Related: [`lint-kit`](https://github.com/parisek/lint-kit), the lint rules.
