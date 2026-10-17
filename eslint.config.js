import { fixupPluginRules } from '@eslint/compat';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import testingLibrary from 'eslint-plugin-testing-library';
import tseslint from 'typescript-eslint';

import { eslintRules } from './tooling/eslint-rules/index.js';

const reactPlugin = fixupPluginRules(react);
const jsxA11yPlugin = fixupPluginRules(jsxA11y);

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/generated/**',
      'pnpm-lock.yaml',
      'vite.config.*',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked.map((typescriptConfig) => ({
    ...typescriptConfig,
    files: ['**/*.{ts,tsx,mts,cts}'],
  })),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'my-wallets': { rules: eslintRules },
    },
    rules: {
      'my-wallets/no-single-letter-bindings': 'error',
      'my-wallets/no-convenience-barrel': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^node:'], ['^(?!@my-wallets/)(?:@?\\w)'], ['^@my-wallets/', '^@/'], ['^\\.']],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'error',
    },
  },
  {
    files: ['**/schemas/**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          modifiers: ['exported'],
          format: ['camelCase'],
          suffix: ['Schema'],
        },
        {
          selector: 'typeAlias',
          modifiers: ['exported'],
          format: ['PascalCase'],
          suffix: ['Input'],
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx}', 'packages/contracts/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11yPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      'react/function-component-definition': [
        'error',
        { namedComponents: 'function-declaration', unnamedComponents: 'function-expression' },
      ],
      'react/jsx-key': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/no-array-index-key': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['apps/web/src/app/routes/**/*.{ts,tsx}', 'apps/web/src/lib/requireSession.ts'],
    rules: {
      // React Router handles thrown Responses as redirects or route errors.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
    },
  },
  {
    ...testingLibrary.configs['flat/react'],
    files: ['apps/web/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      ...testingLibrary.configs['flat/react'].rules,
      'testing-library/prefer-screen-queries': 'error',
      'testing-library/no-container': 'error',
    },
  },
  eslintConfigPrettier,
);
