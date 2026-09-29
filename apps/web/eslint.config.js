import react from '@conch/eslint-config/react';
import globals from 'globals';

export default [
  ...react,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
];
