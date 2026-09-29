import '../src/styles/index.css';
import './preview.css';

import type { Decorator, Preview } from '@storybook/react-vite';

import { accents, NacreProvider, type AccentName, type ColorMode } from '../src';

const withNacre: Decorator = (Story, context) => {
  const { mode, accent, lustre, radius, motion } = context.globals as {
    mode: ColorMode;
    accent: AccentName;
    lustre: string;
    radius: string;
    motion: 'system' | 'reduced';
  };
  return (
    <NacreProvider
      mode={mode}
      accent={accent}
      lustre={Number(lustre)}
      radius={Number(radius)}
      motion={motion}
    >
      <Story />
    </NacreProvider>
  );
};

const preview: Preview = {
  decorators: [withNacre],
  globalTypes: {
    mode: {
      description: 'Colour mode',
      toolbar: {
        title: 'Mode',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Pearl (light)', icon: 'sun' },
          { value: 'dark', title: 'Abalone (dark)', icon: 'moon' },
          { value: 'system', title: 'System', icon: 'browser' },
        ],
        dynamicTitle: true,
      },
    },
    accent: {
      description: 'Accent colour',
      toolbar: {
        title: 'Accent',
        icon: 'paintbrush',
        items: Object.keys(accents).map((name) => ({ value: name, title: name })),
        dynamicTitle: true,
      },
    },
    lustre: {
      description: 'Lustre intensity',
      toolbar: {
        title: 'Lustre',
        icon: 'lightning',
        items: [
          { value: '1', title: 'Lustre: full' },
          { value: '0.5', title: 'Lustre: subtle' },
          { value: '0', title: 'Lustre: off' },
        ],
        dynamicTitle: true,
      },
    },
    radius: {
      description: 'Corner radius scale',
      toolbar: {
        title: 'Radius',
        icon: 'circlehollow',
        items: [
          { value: '0.4', title: 'Radius: crisp' },
          { value: '1', title: 'Radius: default' },
          { value: '1.5', title: 'Radius: round' },
        ],
        dynamicTitle: true,
      },
    },
    motion: {
      description: 'Motion preference',
      toolbar: {
        title: 'Motion',
        icon: 'play',
        items: [
          { value: 'system', title: 'Motion: system' },
          { value: 'reduced', title: 'Motion: reduced' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { mode: 'light', accent: 'coral', lustre: '1', radius: '1', motion: 'system' },
  parameters: {
    layout: 'centered',
    backgrounds: { disable: true },
    controls: { expanded: true, matchers: { color: /(background|color)$/i } },
    a11y: { test: 'error' },
    options: {
      storySort: {
        order: ['Introduction', 'Foundations', 'Components', 'Patterns'],
      },
    },
  },
};

export default preview;
