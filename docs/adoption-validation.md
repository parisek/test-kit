# Package adoption validation

Run `node tests/integration/check-consumer-install.mjs` to check the packed
package in temporary anonymous consumer directories (R13.28, R13.29).
The check uses the local npm cache by default. Set
`TEST_KIT_CONSUMER_ALLOW_NETWORK=1` to permit dependency downloads.
CI permits downloads because a fresh runner may lack registry metadata.

The directories represent these layouts:

- Parent: `static/`.
- WordPress: `wp-content/themes/example-theme/static/`.
- Drupal: `web/themes/custom/example-theme/static/`.

The check installs the actual tarball without optional peers. It verifies
the public imports, linked CLI, compiled viewer, template, summary, bounded
HTML query, and reinstall from the generated lockfile. It does not install
Playwright, Lighthouse, Chrome, Vue, or Vite in the consumer.

The check does not start a CMS or DDEV. It does not prove installation from
an approved Git release. It does not replace a pilot on a real project.
The current CLI has no `init` command. Copy the JSON template manually.

Before retiring synced files, use the exact owner-approved release tag and
its commit in both the manifest and lockfile. The skeleton retirement guard
must pass. Keep project overrides and component contracts in the project.
