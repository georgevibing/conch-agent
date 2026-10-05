import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { PearlProgress } from './PearlProgress';
import { ReleaseNotes } from './ReleaseNotes';
import { UpdateChip } from './UpdateChip';
import { UpdateDialog, type UpdateDialogProps, type UpdateDialogStage } from './UpdateDialog';

const changes = [
  'A chat Conch restarted under says so, carries on by itself, and never shows a stuck Stop',
  'A model download that just began never reads as not started',
  'Natural voices download, and Codex shows once in Usage and the model picker',
  'Bring Hermes and OpenClaw’s other agents over from a page inside Settings',
  'Your photo beside your name, and sealing found by itself',
  'Browser tabs come back as you left them',
  'Routines reach your apps and chat apps',
];

const later = (label = 'Later') => (
  <Button variant="ghost" key="later">
    {label}
  </Button>
);

const meta = {
  title: 'Patterns/Updates/UpdateDialog',
  component: UpdateDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Conch’s own update, from anywhere: what the next version (or the next commits) brings, one press, and the update itself. The pearl grows a ring of nacre as the update comes together, a soft light reads down what’s coming while you wait, ripples spread while Conch starts again, and the ring blooms once when you’re on the new version. The same dialog carries you from ready to done — it only ever moves forward — and you can close it and keep working at any point.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
    stage: 'ready',
    title: '16 improvements are ready',
    detail: 'You have 0.4.2 · main a1b2c3d → f00ba12',
    changes,
    more: 9,
    footnote: 'About a minute. You can keep working; Conch restarts by itself.',
    action: [
      later(),
      <Button key="go" leadingIcon={<RefreshCw />}>
        Update now
      </Button>,
    ],
  },
  argTypes: {
    stage: { control: 'select', options: ['ready', 'updating', 'restarting', 'done', 'failed'] },
    action: { control: false },
    notes: { control: false },
  },
} satisfies Meta<typeof UpdateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async () => {
    const page = within(document.body);
    await expect(
      await page.findByRole('dialog', { name: '16 improvements are ready' }),
    ).toBeVisible();
    await expect(page.getByText('and 9 more changes')).toBeVisible();
  },
};

export const ReadyRelease: Story = {
  name: 'Ready: a release',
  args: {
    title: 'Conch 0.5 is ready',
    detail: 'You have 0.4.2',
    notes: (
      <ReleaseNotes
        releases={[
          {
            version: '0.5.0',
            date: '4 October',
            headsUp: [],
            new: ['Update Conch from anywhere, and watch the new version arrive'],
            better: ['Browser tabs come back as you left them'],
            fixed: ['A model download that just began never reads as not started'],
          },
        ]}
      />
    ),
    more: 0,
  },
};

export const Updating: Story = {
  args: {
    stage: 'updating',
    title: 'Updating Conch',
    progress: { label: 'Installing', value: 48, step: 2, steps: 3 },
    footnote: 'You can keep working. Conch restarts by itself when it’s ready.',
    action: <Button variant="ghost">Keep working</Button>,
  },
};

export const Restarting: Story = {
  args: {
    stage: 'restarting',
    title: 'Starting the new Conch',
    detail: 'A few seconds. Your chats are safe.',
    footnote: undefined,
    action: undefined,
  },
};

export const Done: Story = {
  args: {
    stage: 'done',
    title: 'You’re on the new Conch',
    detail: '16 improvements · Updated just now',
    more: 9,
    footnote: undefined,
    action: <Button>Done</Button>,
  },
};

export const Failed: Story = {
  name: 'Failed: went back',
  args: {
    stage: 'failed',
    title: 'The update didn’t finish',
    detail: 'Nothing of yours changed.',
    changes: [],
    notice: {
      tone: 'warning',
      message:
        'The new version wouldn’t build, so Conch went back to the version you had. It works as before.',
    },
    footnote: undefined,
    action: [
      later('Close'),
      <Button key="retry" leadingIcon={<RotateCcw />}>
        Try again
      </Button>,
    ],
  },
};

export const Refused: Story = {
  name: 'Failed: changes of yours',
  args: {
    stage: 'failed',
    title: 'Conch can’t update by itself',
    detail: 'You have 0.4.2 · main a1b2c3d',
    notice: {
      tone: 'warning',
      message:
        'Conch’s folder has changes that aren’t saved in git (2 files), so updating by itself could lose them.',
      command: ['git stash', 'git pull --ff-only', 'git stash pop', 'pnpm install'].join('\n'),
    },
    footnote: undefined,
    action: later('Close'),
  },
};

/** The whole journey, as the real update goes: ready → updating → restarting → done. */
export const Journey: Story = {
  render: (args) => {
    const [stage, setStage] = useState<UpdateDialogStage>('ready');
    const [value, setValue] = useState(0);
    useEffect(() => {
      if (stage === 'updating') {
        const timer = setInterval(() => setValue((v) => Math.min(100, v + 1.5)), 120);
        return () => clearInterval(timer);
      }
      if (stage === 'restarting') {
        const timer = setTimeout(() => setStage('done'), 3500);
        return () => clearTimeout(timer);
      }
    }, [stage]);
    useEffect(() => {
      if (value >= 100) setStage('restarting');
    }, [value]);
    const step = value < 12 ? 1 : value < 45 ? 2 : 3;
    const props: Partial<UpdateDialogProps> =
      stage === 'ready'
        ? {
            action: [
              later(),
              <Button key="go" leadingIcon={<RefreshCw />} onClick={() => setStage('updating')}>
                Update now
              </Button>,
            ],
          }
        : stage === 'updating'
          ? {
              title: 'Updating Conch',
              progress: {
                label:
                  ['Getting the update', 'Installing', 'Getting the new look ready'][step - 1] ??
                  '',
                value,
                step,
                steps: 3,
              },
              footnote: 'You can keep working. Conch restarts by itself when it’s ready.',
              action: <Button variant="ghost">Keep working</Button>,
            }
          : stage === 'restarting'
            ? {
                title: 'Starting the new Conch',
                detail: 'A few seconds. Your chats are safe.',
                footnote: undefined,
                action: undefined,
              }
            : {
                title: 'You’re on the new Conch',
                detail: '16 improvements · Updated just now',
                footnote: undefined,
                action: (
                  <Button
                    onClick={() => {
                      setValue(0);
                      setStage('ready');
                    }}
                  >
                    Done
                  </Button>
                ),
              };
    return <UpdateDialog {...args} {...props} stage={stage} />;
  },
};

/** The ring alone, in each of its states. */
export const Pearls: Story = {
  render: () => (
    <Stack direction="row" gap={8} align="center" wrap style={{ padding: '3rem' }}>
      {(
        [
          ['resting', undefined],
          ['working', 64],
          ['working', undefined],
          ['restarting', undefined],
          ['done', undefined],
          ['failed', undefined],
        ] as const
      ).map(([state, value]) => (
        <Stack key={`${state}${value ?? ''}`} gap={3} align="center">
          <PearlProgress state={state} value={value} />
          <Text size="xs" tone="muted">
            {state}
            {value !== undefined ? ` ${value}%` : ''}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

/** Beside your name at the foot of the sidebar. */
export const Chip: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center" style={{ padding: '3rem' }}>
      <UpdateChip state="ready" aria-label="Update Conch: 16 improvements" />
      <UpdateChip state="updating" value={64} aria-label="Updating Conch, 64%" />
      <UpdateChip state="updating" aria-label="Updating Conch" />
      <UpdateChip state="restart" aria-label="Restart Conch to finish updating" />
    </Stack>
  ),
};
