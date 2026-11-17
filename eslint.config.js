import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const NAMED_EXPORTS = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports.',
};

const WAIT_TIMEOUT_MESSAGE =
  'The web tests have one wait limit, set in apps/web/src/test/time-limits.ts: no wait has its own.';
const WAIT_CALL = '/^(find(All)?By|waitFor)/';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/migrations/']),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', NAMED_EXPORTS],
    },
  },
  {
    // ESLint, Vitest, Drizzle Kit and commitlint all load their configuration from a default export.
    files: ['**/*.config.{js,ts}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },
  {
    files: ['apps/web/src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        NAMED_EXPORTS,
        ...[`callee.name=${WAIT_CALL}`, `callee.property.name=${WAIT_CALL}`].map((callee) => ({
          selector: `CallExpression[${callee}] > ObjectExpression > Property[key.name="timeout"]`,
          message: WAIT_TIMEOUT_MESSAGE,
        })),
      ],
    },
  },
  {
    // The shadcn components export their variants beside the component, as shadcn writes them.
    files: ['apps/web/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
