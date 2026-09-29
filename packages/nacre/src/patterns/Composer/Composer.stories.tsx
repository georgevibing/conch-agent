import type { Meta, StoryObj } from '@storybook/react-vite';
import { AtSign, ChevronDown, Paperclip, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Composer, ComposerAttachment } from './Composer';

const toolbar = (
  <>
    <IconButton size="sm" label="Attach files" shortcut="mod+u">
      <Paperclip />
    </IconButton>
    <IconButton size="sm" label="Mention a file">
      <AtSign />
    </IconButton>
    <Button size="sm" variant="ghost" leadingIcon={<Sparkles />} trailingIcon={<ChevronDown />}>
      Opus 5.5
    </Button>
  </>
);

const meta = {
  title: 'Patterns/Chat/Composer',
  component: Composer,
  args: { onSubmit: fn(), onStop: fn(), toolbar },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The chat input — the most-touched surface in Conch. It grows with its content, sends on Enter (Shift+Enter for a newline, safe for IME composition), and while Claude is working it wears an orbiting band of pearl light and a soft halo, and Send morphs into Stop (Esc also stops).',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720, marginInline: 'auto', paddingBlock: 48 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Running: Story = {
  args: { running: true, placeholder: 'Claude is working… Esc to stop' },
};

export const WithAttachments: Story = {
  args: {
    defaultValue: 'Why does this test fail on CI but not locally?',
    attachments: (
      <>
        <ComposerAttachment name="session.test.ts" meta="4.2 KB" onRemove={fn()} />
        <ComposerAttachment name="ci-log.txt" meta="Lines 120–184" onRemove={fn()} />
        <ComposerAttachment
          name="screenshot.png"
          kind="image"
          meta="PNG · 312 KB"
          onRemove={fn()}
        />
      </>
    ),
  },
};

export const Multiline: Story = {
  args: {
    defaultValue:
      'Refactor the relay:\n\n1. Validate frames with the protocol schema\n2. Replace the string buffer with a typed queue\n3. Stop iterating when the socket closes\n4. Add tests for malformed frames',
  },
};

export const Disabled: Story = {
  args: { disabled: true, placeholder: 'Connecting to Claude Code…' },
};

export const Interactive: Story = {
  render: function Render(args) {
    const [running, setRunning] = useState(false);
    const [sent, setSent] = useState<string[]>([]);
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Composer
          {...args}
          running={running}
          onSubmit={(value) => {
            setSent((s) => [...s, value]);
            setRunning(true);
            setTimeout(() => setRunning(false), 4000);
          }}
          onStop={() => setRunning(false)}
        />
        <ol style={{ margin: 0, color: 'var(--nc-text-muted)', fontSize: 13 }}>
          {sent.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    );
  },
};
