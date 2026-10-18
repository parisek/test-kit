// Entry point `@parisek/test-kit/packs/lint`. Pure. The runner is a separate entry point because it starts processes.
export { lintPack } from './pack.js';
export { normalizeEslint, normalizeStylelint, judgeRun, relativeFile, checkLocation, TOOLS, MAX_FINDINGS, MAX_ITEMS, MAX_OUTPUT_BYTES } from './normalize.js';
