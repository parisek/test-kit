// Runs a test module only when the lint peers it needs are installed (R13.46).
// `npm test` needs no dependency: a missing peer skips the module and says why.
// CI sets TEST_KIT_REQUIRE_LINT_PEERS=1 after `npm ci`, so a missing peer fails there and a skip cannot hide.
import test from 'node:test';

export async function runWithPeers(title, peers, load) {
  const missing = [];
  for (const name of peers) {
    try {
      await import(name);
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      missing.push(name);
    }
  }
  if (!missing.length) return load();
  const reason = `${title} needs ${missing.join(', ')}. Run "npm ci" to install the development dependencies.`;
  if (process.env.TEST_KIT_REQUIRE_LINT_PEERS === '1') throw new Error(reason);
  test(title, { skip: reason }, () => {});
  return undefined;
}
