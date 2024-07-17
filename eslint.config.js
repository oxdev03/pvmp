/* eslint-disable @typescript-eslint/no-var-requires */
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'out', '**/*.d.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.es2020,
        ...globals.node,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': ['off'],
    },
  }
);
