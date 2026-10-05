import type { Meta, StoryObj } from '@storybook/react-vite';
import { Folder, Mic } from 'lucide-react';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { IconButton } from '../../components/IconButton';
import { Tooltip } from '../../components/Tooltip';
import { ContextMeter } from '../ContextMeter';
import { DemoToolbar } from '../ModelPicker/fixtures';
import { Composer, ComposerAttachment, ComposerChip, ComposerQueued } from './Composer';
import { ComposerQueue } from './ComposerQueue';

function FolderChip({ path }: { path: string }) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return (
    <Tooltip content={path}>
      <ComposerChip icon={<Folder />} tuck aria-label={`Working folder: ${name}`}>
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

/** Sent while the agent works: it waits above the box and goes by itself when the reply ends. */
export const Queued: Story = {
  args: {
    running: true,
    allowSubmitWhileRunning: true,
    placeholder: 'Conch is working… Write what’s next',
    queued: (
      <ComposerQueued
        text="And when you're done, run the tests again and tell me which ones still fail."
        meta="Sends when Conch is done"
        onEdit={fn()}
        onRemove={fn()}
      />
    ),
  },
};

/** ↑ in the empty box brings back what you sent, newest first; ↓ walks forward again. */
export const History: Story = {
  args: {
    history: [
      'Plan my week. Ask me a couple of questions first.',
      'Make it shorter, and move the dentist to Thursday.',
      'Send it to Ada.',
    ],
    placeholder: 'Press ↑ for what you sent before',
  },
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
          history={sent}
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

const mic = (
  <IconButton label="Dictate" shape="circle">
    <Mic />
  </IconButton>
);

/**
 * With nothing typed, the one button is Talk, in a slow ring of pearl
 * light; typing turns it into Send.
 */
export const TalkWhenEmpty: Story = {
  args: { voice: { label: 'Talk with Conch', onClick: fn() }, actions: mic },
};

/**
 * On a phone the composer keeps to one calm line: the mode is its tinted
 * icon, the model keeps its name, the folder steps out (Settings has it),
 * and Talk shares Send's place.
 */
export const Phone: Story = {
  args: {
    voice: { label: 'Talk with Conch', onClick: fn() },
    actions: mic,
    placeholder: 'Message Conch, or type / for commands',
    toolbar: (
      <>
        <DemoToolbar initial={{ mode: 'bypassPermissions', effort: 'medium' }} />
        <ContextMeter used={84_000} window={200_000} />
        <FolderChip path="~/projects/conch" />
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 390, marginInline: 'auto', paddingInline: 12 }}>
        <Story />
      </div>
    ),
  ],
};

/** On a phone while it works: Stop takes the place, and the ring counts what it has used. */
export const PhoneRunning: Story = {
  ...Phone,
  args: {
    ...Phone.args,
    running: true,
    placeholder: 'Conch is working… Write what’s next',
    toolbar: (
      <>
        <DemoToolbar initial={{ mode: 'bypassPermissions', effort: 'medium' }} />
        <ContextMeter used={184_000} window={200_000} working={1_240_000} running />
        <FolderChip path="~/projects/conch" />
      </>
    ),
  },
};

/** The smallest phones (320 px), nearly full: the model's name gives way first, never the ring. */
export const PhoneSmall: Story = {
  ...Phone,
  args: {
    ...Phone.args,
    toolbar: (
      <>
        <DemoToolbar initial={{ mode: 'acceptEdits', effort: 'medium' }} />
        <ContextMeter used={186_000} window={200_000} />
        <FolderChip path="~/projects/conch" />
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 320, marginInline: 'auto', paddingInline: 8 }}>
        <Story />
      </div>
    ),
  ],
};

function QueueDemo({ width }: { width?: number }) {
  const [items, setItems] = useState([
    { id: 'a', text: 'Once the PR is green, figure out why GitHub CI is failing on main' },
    { id: 'b', text: 'Then update the docs for the new queue', meta: '2 files' },
    { id: 'c', text: 'And tell me what changed, in a few lines' },
  ]);
  return (
    <div style={{ maxInlineSize: width, marginInline: 'auto' }}>
      <Composer
        running
        allowSubmitWhileRunning
        onStop={fn()}
        placeholder="Conch is working… Write what’s next"
        toolbar={toolbar}
        onSubmit={(text) => setItems((q) => [...q, { id: `${Date.now()}`, text }])}
        queued={
          items.length > 0 && (
            <ComposerQueue
              items={items}
              name="Conch"
              onReorder={(ids) =>
                setItems((q) => ids.flatMap((id) => q.find((i) => i.id === id) ?? []))
              }
              onSteer={(id) => setItems((q) => q.filter((i) => i.id !== id))}
              onEdit={(id) => setItems((q) => q.filter((i) => i.id !== id))}
              onRemove={(id) => setItems((q) => q.filter((i) => i.id !== id))}
            />
          )
        }
      />
    </div>
  );
}

/**
 * Several messages written while it works wait their turn above the box, and
 * go one at a time. Drag one by its handle to change the order (the others
 * make room as it passes), or move it with the arrow keys; **Steer** sends one
 * now, stopping what's running.
 */
export const Queue: Story = { render: () => <QueueDemo /> };

/** The same on a phone: drag with a finger on the handle. */
export const QueuePhone: Story = { render: () => <QueueDemo width={390} /> };
