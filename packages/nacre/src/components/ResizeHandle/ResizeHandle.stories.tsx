import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ResizeHandle } from './ResizeHandle';

const meta = {
  title: 'Components/Layout/ResizeHandle',
  component: ResizeHandle,
  args: { label: 'Resize the panel', value: 320, min: 200, max: 520, onValueChange: () => {} },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The seam between two panes, e.g. a chat and its browser. Drag it, or focus it and use the arrow keys (Shift for bigger steps, Home and End for the limits). A slim pill that brightens under the pointer.',
      },
    },
  },
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function Render(args) {
    const [width, setWidth] = useState(args.value);
    return (
      <div
        style={{
          display: 'flex',
          blockSize: 240,
          border: '1px solid var(--nc-border-subtle)',
          borderRadius: 12,
        }}
      >
        <div style={{ flex: 1, padding: 16, color: 'var(--nc-text-muted)' }}>Chat</div>
        <ResizeHandle {...args} value={width} onValueChange={setWidth} />
        <div style={{ inlineSize: width, padding: 16, background: 'var(--nc-surface-sunken)' }}>
          Panel · {width}px
        </div>
      </div>
    );
  },
};
