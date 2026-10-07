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

Related: [`lint-kit`](https://github.com/parisek/lint-kit), the lint rules.
