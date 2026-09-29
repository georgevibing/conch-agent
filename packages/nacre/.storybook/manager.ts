import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle: 'Conch · Nacre',
    brandTarget: '_self',
    fontBase: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
    fontCode: '"Geist Mono Variable", ui-monospace, monospace',
    colorPrimary: '#c8553d',
    colorSecondary: '#c8553d',
    appBg: '#f8f6f3',
    appContentBg: '#fdfcfb',
    appBorderColor: 'rgba(40, 30, 20, 0.08)',
    appBorderRadius: 10,
    textColor: '#2a2522',
    barBg: '#fdfcfb',
  }),
  sidebar: { showRoots: true },
});
