import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'tests/playwright/'],
  }
);
