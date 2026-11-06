// Entry point `@parisek/test-kit/stylelint` (R13.40, R13.46 to R13.50).
// A CommonJS file, so `require` and `import` both load it. It exports the shared config object.
// A project spreads it and adds its own values:
//   const testKit = require('@parisek/test-kit/stylelint');
//   module.exports = { ...testKit, rules: { ...testKit.rules, 'portadesign/import-order': null } };
// Loading it resolves the lint peers only. It loads no browser package.
const { assertPeers } = require('./peers.cjs');

assertPeers();

module.exports = require('./config.cjs');
