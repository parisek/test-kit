// Tests for the four portadesign ESLint rules (R13.40, R13.50). Pure: no browser, no network.
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from '../../src/eslint/rules/index.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});
const tsTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', parser: tseslint.parser },
});

test('the plugin keeps exactly the four rule names (R13.40)', () => {
  assert.deepEqual(Object.keys(plugin.rules).sort(), [
    'no-deprecated-dependency',
    'no-top-level-heavy-lib-import',
    'no-top-level-throw',
    'require-reduced-motion-guard',
  ]);
});

ruleTester.run('no-top-level-heavy-lib-import', plugin.rules['no-top-level-heavy-lib-import'], {
  valid: [
    { code: 'if (document.querySelector(".x")) { import("gsap").then(() => {}); }' },
    { code: 'import { something } from "./local.js";' },
    { code: '// portadesign/heavy-lib-runtime-owner\nimport gsap from "gsap";' },
    { code: 'import "vue";', filename: '/p/templates/component/demo/js/demo.js' },
    { code: 'import { createApp } from "vue";', filename: '/p/templates/component/demo/js/demo.js' },
    { code: 'import { createApp } from "vue";', filename: '/p/x/Widget.vue' },
    { code: 'import gsap from "gsap";', options: [{ heavyLibs: ['lightgallery'] }] },
  ],
  invalid: [
    { code: 'import gsap from "gsap";', errors: [{ messageId: 'topLevel', data: { source: 'gsap' } }] },
    { code: 'import { createApp } from "vue";', filename: '/p/src/js/boot.js', errors: [{ messageId: 'topLevel' }] },
    { code: 'import Tippy from "tippy.js";', options: [{ heavyLibs: ['tippy.js'] }], errors: [{ messageId: 'topLevel' }] },
    { code: 'import gsap from "gsap";', filename: '/p/templates/component/demo/js/demo.js', errors: [{ messageId: 'topLevel' }] },
  ],
});

tsTester.run('no-top-level-heavy-lib-import (TypeScript)', plugin.rules['no-top-level-heavy-lib-import'], {
  valid: [
    { code: 'import type { Ref } from "vue";' },
    { code: 'import { type Ref } from "vue";' },
  ],
  invalid: [
    { code: 'import { ref, type Ref } from "vue";', filename: '/p/src/js/boot.ts', errors: [{ messageId: 'topLevel' }] },
  ],
});

ruleTester.run('no-deprecated-dependency', plugin.rules['no-deprecated-dependency'], {
  valid: [
    { code: 'import x from "left-pad";' },
    { code: 'import x from "tippy.js";', options: [{ deprecated: { jquery: 'use the DOM' } }] },
  ],
  invalid: [
    { code: 'import tippy from "tippy.js";', errors: [{ messageId: 'deprecated', data: { source: 'tippy.js', reason: 'Tippy.js is archived. Use @floating-ui/dom + an x-tooltip directive.' } }] },
    { code: 'import $ from "jquery";', errors: [{ messageId: 'deprecated' }] },
    { code: 'import x from "left-pad";', options: [{ deprecated: { 'left-pad': 'use padStart' } }], errors: [{ messageId: 'deprecated' }] },
  ],
});

ruleTester.run('no-top-level-throw', plugin.rules['no-top-level-throw'], {
  valid: [
    { code: 'export function f() { throw new Error("x"); }' },
    { code: 'const g = () => { throw new Error("x"); };' },
    { code: 'class A { m() { throw new Error("x"); } }' },
    { code: 'try { throw new Error("x"); } catch (e) { console.warn(e); }' },
    { code: 'if (a) { try { if (b) throw new Error("x"); } catch { } }' },
  ],
  invalid: [
    { code: 'throw new Error("x");', errors: [{ messageId: 'topLevelThrow' }] },
    { code: 'if (!wrapper) throw new Error("Missing wrapper");', errors: [{ messageId: 'topLevelThrow' }] },
    { code: 'try { f(); } catch (e) { throw e; }', errors: [{ messageId: 'topLevelThrow' }] },
    { code: 'try { f(); } finally { throw new Error("x"); }', errors: [{ messageId: 'topLevelThrow' }] },
    { code: 'try { f(); } finally { cleanup(); }\nthrow new Error("x");', errors: [{ messageId: 'topLevelThrow' }] },
  ],
});

ruleTester.run('require-reduced-motion-guard', plugin.rules['require-reduced-motion-guard'], {
  valid: [
    { code: 'import { x } from "./local.js";' },
    { code: 'import vue from "vue";' },
    { code: 'import gsap from "gsap";\nconst q = window.matchMedia("(prefers-reduced-motion: reduce)");' },
    { code: '// portadesign/heavy-lib-runtime-owner\nimport gsap from "gsap";' },
    { code: 'import gsap from "gsap";', options: [{ animationLibs: ['lottie-web'] }] },
  ],
  invalid: [
    { code: 'import gsap from "gsap";', errors: [{ messageId: 'unguarded', data: { source: 'gsap' } }] },
    // A comment that names the token does not count as a guard.
    { code: '/* does not need prefers-reduced-motion */\nimport gsap from "gsap";', errors: [{ messageId: 'unguarded' }] },
    // One report for each file, on the first import.
    { code: 'import gsap from "gsap";\nimport { ScrollTrigger } from "gsap/ScrollTrigger";', errors: [{ messageId: 'unguarded', line: 1 }] },
    { code: 'import lottie from "lottie-web";', errors: [{ messageId: 'unguarded' }] },
    { code: 'import x from "my-anim";', options: [{ animationLibs: ['my-anim'] }], errors: [{ messageId: 'unguarded' }] },
  ],
});
