import base from '@conch/eslint-config/base';
import globals from 'globals';

export default [
  // The bundle, the gateway it carries and the installers are built, never written.
  { ignores: ['dist/', 'payload/', 'out/'] },
  ...base,
  { languageOptions: { globals: { ...globals.node } } },
  // The status page's script runs in the window.
  { files: ['pages/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
];
