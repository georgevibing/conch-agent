import type { Meta, StoryObj } from '@storybook/react-vite';
import { Folder } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Tooltip } from '../../components/Tooltip';
import { DemoToolbar } from '../ModelPicker/fixtures';
import { Composer, ComposerAttachment, ComposerChip } from './Composer';

function FolderChip({ path }: { path: string }) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return (
    <Tooltip content={path}>
      <ComposerChip icon={<Folder />} aria-label={`Working folder: ${name}`}>
        {name}
      </ComposerChip>
    </Tooltip>
  );
}

const toolbar = (
  <>
    <DemoToolbar />
    <FolderChip path="~/projects/conch" />
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

/**
 * When the footer runs short, things give way in order: the keyboard hint
 * goes first, then the folder name truncates (the tooltip keeps the full
 * path), then the model name. The mode chip is a safety setting and never
 * truncates; send never moves.
 */
export const CrowdedToolbar: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 24 }}>
      {[640, 520, 400, 320].map((width) => (
        <div key={width} style={{ inlineSize: width }}>
          <Composer
            {...args}
            toolbar={
              <>
                <DemoToolbar
                  initial={{ model: 'opus', effort: 'xhigh', fast: true, mode: 'acceptEdits' }}
                />
                <FolderChip path="C:\Users\ada\projects\conch-agent-experiments" />
              </>
            }
          />
        </div>
      ))}
    </div>
  ),
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
