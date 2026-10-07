import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Text } from '../Text';
import { PanelPresence, type PanelSide } from './PanelPresence';

const meta = {
  title: 'Components/Overlays/PanelPresence',
  component: PanelPresence,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'How every panel appears and leaves — "glint". It surfaces a few pixels from its edge with a touch of spring while a band of pearl light crosses it, then sinks back quicker as it leaves, the light running back fainter. Only transform and opacity move. Use it for every panel that comes and goes (a Sheet already moves the same way); never hand-roll another.',
      },
    },
  },
  args: { open: true, side: 'right', children: null },
} satisfies Meta<typeof PanelPresence>;

export default meta;
type Story = StoryObj<typeof meta>;

// The glint takes the panel's corners.
const rounded = { borderRadius: 'var(--nc-radius-lg)' };

function Card({ title, body }: { title: string; body: string }) {
  return (
    <Surface
      variant="raised"
      style={{
        blockSize: '100%',
        padding: 'var(--nc-space-4)',
        borderRadius: 'var(--nc-radius-lg)',
      }}
    >
      <Text weight="medium">{title}</Text>
      <Text size="sm" tone="muted">
        {body}
      </Text>
    </Surface>
  );
}

export const Playground: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(args.open);
    const vertical = args.side === 'bottom' || args.side === 'top';
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          blockSize: 420,
          gap: 'var(--nc-space-3)',
          padding: 'var(--nc-space-4)',
        }}
      >
        <Stack
          gap={2}
          style={{ flex: 1, order: args.side === 'left' || args.side === 'top' ? 1 : 0 }}
        >
          <Button onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Open'} the panel</Button>
        </Stack>
        <PanelPresence
          {...args}
          open={open}
          style={{ ...rounded, ...(vertical ? { blockSize: 180 } : { inlineSize: 320 }) }}
        >
          <Card title="Browser" body="Opened beside the chat, the way every panel arrives." />
        </PanelPresence>
      </div>
    );
  },
};

const sides: { side: PanelSide; title: string; body: string }[] = [
  { side: 'left', title: 'Sidebar', body: 'Chats, tasks and routines.' },
  { side: 'bottom', title: 'Terminal', body: 'A shell on this computer.' },
  { side: 'right', title: 'Made for you', body: 'What the assistant made.' },
];

/** The sidebar, the terminal and a dock — one motion for all of them. */
export const EverySide: Story = {
  render: function Render() {
    const [open, setOpen] = useState<Record<PanelSide, boolean>>({
      left: true,
      right: true,
      bottom: true,
      top: false,
    });
    const toggle = (side: PanelSide) => setOpen((o) => ({ ...o, [side]: !o[side] }));
    return (
      <div
        style={{
          display: 'flex',
          blockSize: 480,
          gap: 'var(--nc-space-3)',
          padding: 'var(--nc-space-4)',
        }}
      >
        <PanelPresence open={open.left} side="left" style={{ ...rounded, inlineSize: 220 }}>
          <Card title="Sidebar" body="Chats, tasks and routines." />
        </PanelPresence>
        <div
          style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 'var(--nc-space-3)' }}
        >
          <Stack direction="row" gap={2} style={{ flex: 1 }}>
            {sides.map((s) => (
              <Button key={s.side} variant="soft" onClick={() => toggle(s.side)}>
                {s.title}
              </Button>
            ))}
          </Stack>
          <PanelPresence open={open.bottom} side="bottom" style={{ ...rounded, blockSize: 160 }}>
            <Card title="Terminal" body="A shell on this computer." />
          </PanelPresence>
        </div>
        <PanelPresence open={open.right} side="right" style={{ ...rounded, inlineSize: 260 }}>
          <Card title="Made for you" body="What the assistant made." />
        </PanelPresence>
      </div>
    );
  },
};
