import type { CSSModulesOptions } from 'vite';

/**
 * CSS Modules settings every consumer of Nacre's source must use.
 *
 * CSS Modules localises every identifier, including `animation-name`s. Nacre's
 * shared keyframes (`nc-surface-in`, `nc-spin`, …) live in the global
 * `styles/motion.css`, so any identifier starting with `nc-` is kept global;
 * everything else is scoped as `nc-<File>-<name>`.
 */
export const nacreCssModules: CSSModulesOptions = {
  localsConvention: 'camelCaseOnly',
  generateScopedName: (name, filename) => {
    if (name.startsWith('nc-')) return name;
    const file = filename.split('/').pop()?.split('.')[0] ?? 'nc';
    return `nc-${file}-${name}`;
  },
};
