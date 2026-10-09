import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import storybook from 'eslint-plugin-storybook';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import base from './base.js';

/** React + accessibility rules. Accessibility lint errors are never downgraded. */
export default tseslint.config(
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      'react/prop-types': 'off',
      // A module that names something `window` hides the real one from React's refresh
      // runtime, and every component after it fails to load in development.
      'no-shadow-restricted-names': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Only at a module's top level: that's where React's refresh code runs.
          selector:
            'Program > :matches(VariableDeclaration, ExportNamedDeclaration > VariableDeclaration) > VariableDeclarator > Identifier.id[name=/^(window|document|globalThis|self)$/], Program > :matches(FunctionDeclaration, ClassDeclaration, ExportNamedDeclaration > FunctionDeclaration) > Identifier.id[name=/^(window|document|globalThis|self)$/]',
          message:
            'Don’t name something window, document, globalThis or self: it hides the real one.',
        },
      ],
    },
  },
  ...storybook.configs['flat/recommended'],
);
