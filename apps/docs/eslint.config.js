import react from '@conch/eslint-config/react';
import globals from 'globals';

export default [
  ...react,
  {
    files: ['reference/**/*.ts', 'publishing/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
];
