// Entry point `@parisek/test-kit/packs/lint`. Pure. The runner is a separate entry point because it starts processes.
export { lintPack } from './pack.js';
export { normalizeEslint, normalizeStylelint, judgeRun, relativeFile, TOOLS, MAX_FINDINGS } from './normalize.js';
