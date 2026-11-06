// Pure. Builds the shared flat config from loaded peers. It reads no file and prints nothing.
// The config holds no project value: no vendor globals, no ignore paths (R13.48).
// A project adds them in its own blocks after this array (R13.40).
import portadesign from './rules/index.js';

const UNUSED = { argsIgnorePattern: '^_', varsIgnorePattern: '^_' };

// Rule levels of the four portadesign rules. `require-reduced-motion-guard` is a warning
// on purpose: a project with many old violations must not turn red at once.
const PORTADESIGN_RULES = {
  'portadesign/no-top-level-heavy-lib-import': 'error',
  'portadesign/no-deprecated-dependency': 'error',
  'portadesign/no-top-level-throw': 'error',
  'portadesign/require-reduced-motion-guard': 'warn',
};

export function buildConfig({ js, importPlugin, globals = null, tseslint = null, vue = null, vueParser = null }) {
  const config = [
    js.configs.recommended,
    {
      name: 'test-kit/eslint/base',
      // `.ts` and `.vue` match here on purpose, so every global, plugin and rule applies to
      // all three the same way. The blocks below add only what each language needs.
      files: ['**/*.{js,mjs,ts,vue}'],
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        globals: { ...(globals?.browser ?? {}) },
      },
      plugins: { import: importPlugin, portadesign },
      rules: {
        'no-unused-vars': ['error', UNUSED],
        // Without the `globals` package no global list exists. The rule goes off, and the entry point warns (R13.47).
        'no-undef': globals ? 'error' : 'off',
        'no-throw-literal': 'error',
        'no-console': ['warn', { allow: ['warn', 'error'] }],
        'no-debugger': 'error',
        'no-empty': ['error', { allowEmptyCatch: true }],
        'import/no-duplicates': 'error',
        'import/no-self-import': 'error',
        ...PORTADESIGN_RULES,
      },
    },
  ];

  if (globals) {
    // Node context: test harnesses, build scripts and config files. A separate block, so a
    // browser file never gains Node globals. The patterns anchor at the working directory.
    config.push({
      name: 'test-kit/eslint/node',
      files: ['**/*.test.{js,mjs,ts}', '**/*.config.{js,mjs,ts}', 'scripts/**', 'tests/**'],
      languageOptions: { globals: { ...globals.node } },
    });
  }

  if (tseslint) {
    // Syntax only. No `projectService`, so no tsconfig.json is needed and no type-aware rule runs.
    config.push({
      name: 'test-kit/eslint/typescript',
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: {
        // The core rule cannot see type-only use. Without this swap every unused variable
        // is reported twice.
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['error', UNUSED],
      },
    });
  }

  if (vue && vueParser) {
    config.push(
      ...vue.configs['flat/recommended'],
      {
        name: 'test-kit/eslint/vue',
        files: ['**/*.vue'],
        // Flat config does not cascade plugin declarations across blocks.
        plugins: { portadesign, ...(tseslint ? { '@typescript-eslint': tseslint.plugin } : {}) },
        languageOptions: {
          parser: vueParser,
          parserOptions: {
            // Without this every `<script setup lang="ts">` fails with a parse error and
            // no rule runs on the file.
            ...(tseslint ? { parser: tseslint.parser } : {}),
            ecmaVersion: 2024,
            sourceType: 'module',
          },
        },
        rules: {
          'vue/multi-word-component-names': 'off',
          ...(tseslint
            ? { 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': ['error', UNUSED] }
            : {}),
          ...PORTADESIGN_RULES,
        },
      },
    );
  }

  return config;
}
