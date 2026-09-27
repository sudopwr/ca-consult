// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'supabase/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ───────────────────────────────────────────────────────────────
  // The dependency rule, enforced. domain ← application ← infra/interface.
  // If this stays green in CI, the architecture is real rather than aspirational.
  // ───────────────────────────────────────────────────────────────
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/api/src/**/*'],
      'boundaries/elements': [
        // composition-root and main are the one exemption: they wire everything.
        { type: 'composition', mode: 'full', pattern: 'apps/api/src/{composition-root,main}.ts' },
        { type: 'config', mode: 'full', pattern: 'apps/api/src/config/**/*' },
        { type: 'domain', mode: 'full', pattern: 'apps/api/src/domain/**/*' },
        { type: 'application', mode: 'full', pattern: 'apps/api/src/application/**/*' },
        { type: 'infrastructure', mode: 'full', pattern: 'apps/api/src/infrastructure/**/*' },
        { type: 'interface', mode: 'full', pattern: 'apps/api/src/interface/**/*' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} is not allowed to import ${dependency.type} — see §3 of the architecture doc',
          rules: [
            { from: 'domain', allow: ['domain'] },
            { from: 'application', allow: ['domain', 'application'] },
            { from: 'infrastructure', allow: ['domain', 'application', 'infrastructure', 'config'] },
            { from: 'interface', allow: ['domain', 'application', 'interface', 'config'] },
            { from: 'composition', allow: ['domain', 'application', 'infrastructure', 'interface', 'config'] },
            { from: 'config', allow: ['config'] },
          ],
        },
      ],
    },
  },

  // Tests may reach anywhere.
  {
    files: ['**/tests/**/*.ts', '**/*.spec.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'boundaries/element-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
