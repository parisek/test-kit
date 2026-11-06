// Checks the required peers of the Stylelint entry point (R13.46, R13.47).
// It resolves them. It does not load them. A missing peer throws LINT_PEER_MISSING.
// It resolves no browser package.

const REQUIRED = [
  { name: 'stylelint', install: 'npm i -D stylelint' },
  { name: 'stylelint-config-standard', install: 'npm i -D stylelint-config-standard' },
];

class LintPeerError extends Error {
  constructor(peer, install) {
    super(`The Stylelint entry point of test-kit needs the package "${peer}", and it is not installed. Install it: ${install}`);
    this.name = 'LintPeerError';
    this.code = 'LINT_PEER_MISSING';
    this.peer = peer;
  }
}

// `resolve` is injectable for tests. The default resolves from this file, so a peer installed
// in the project is found when test-kit is installed in the same project.
function assertPeers(resolve = require.resolve) {
  for (const { name, install } of REQUIRED) {
    try {
      resolve(name);
    } catch (error) {
      if (error && error.code === 'MODULE_NOT_FOUND') throw new LintPeerError(name, install);
      throw error;
    }
  }
}

module.exports = { REQUIRED, LintPeerError, assertPeers };
