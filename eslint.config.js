import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.vercel/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['extension/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['extension/*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['proxy/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, process: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  eslintConfigPrettier,
);
