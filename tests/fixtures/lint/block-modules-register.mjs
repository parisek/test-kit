// Test helper. Use as `node --import <this file>`. The env var TEST_KIT_BLOCK holds a
// comma-separated list of package names that must not resolve.
import { register } from 'node:module';

const blocked = (process.env.TEST_KIT_BLOCK ?? '').split(',').filter(Boolean);
register('./block-modules-hooks.mjs', { parentURL: import.meta.url, data: { blocked } });
