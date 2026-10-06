import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRight, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Switch } from '../../components/Switch';
import { Text } from '../../components/Text';
import { ProgramUpdates } from './ProgramUpdates';
import { SoftwareUpdate } from './SoftwareUpdate';

const whatsNew = [
  'Attach files, pictures and long pastes to a message',
  'Terminals heal a spawn helper that lost its execute bit',
  'Conch keeps itself running, and can start itself again',
  'Providers say when their model runs on this computer',
  'Repair everything: one look at every part of Conch',
];

const meta = {
  title: 'Patterns/Updates/SoftwareUpdate',
  component: SoftwareUpdate,
  parameters: {
    docs: {
      description: {
        component:
          'Conch’s own update, as calm as a phone’s Software Update screen. The pearl, where things stand in a few words, “What’s new” folded away, and one button. While it updates it shows the step it’s on; when one press can’t do it (changes of yours in its folder, a merge), it says why and gives the exact command to run by hand. Nothing here is a toast or a modal: updates wait quietly until you look.',
      },
    },
  },
  args: {
    state: 'available',
    title: 'An update is ready',
    detail: '12 improvements · Checked 2 hours ago',
    whatsNew,
    more: 7,
    action: <Button leadingIcon={<RefreshCw />}>Update Conch</Button>,
    footnote: 'Conch restarts by itself when it’s done. Your chats are safe.',
  },
  argTypes: {
    state: { control: 'select', options: ['current', 'available', 'updating', 'unavailable'] },
    action: { control: false },
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 'min(36rem, calc(100vw - 2rem))' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SoftwareUpdate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const UpToDate: Story = {
  args: {
    state: 'current',
    title: 'Conch is up to date',
    detail: 'Dev · 4b4ebb4 · Checked 2 hours ago',
    whatsNew: [],
    action: undefined,
    footnote: undefined,
  },
};

export const Available: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'What’s new' }));
    await expect(await canvas.findByText('and 7 more')).toBeVisible();
  },
};

export const Updating: Story = {
  args: {
    state: 'updating',
    title: 'Updating Conch',
    detail: '12 improvements',
    progress: { label: 'Installing', value: 48, step: 2, steps: 3 },
  },
};

/** The progress moves through the steps, as the real update does. */
export const UpdatingLive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0);
    useEffect(() => {
      const timer = setInterval(() => setValue((v) => (v >= 100 ? 0 : v + 2)), 120);
      return () => clearInterval(timer);
    }, []);
    const step = value < 20 ? 1 : value < 66 ? 2 : 3;
    const label =
      ['Getting the update', 'Installing', 'Getting the new look ready'][step - 1] ?? '';
    return (
      <SoftwareUpdate
        {...args}
        state="updating"
        title="Updating Conch"
        progress={{ label, value, step, steps: 3 }}
      />
    );
  },
};

export const ChangesOfYours: Story = {
  name: 'Refused: changes of yours',
  args: {
    blocked: {
      reason:
        'Conch’s folder has changes that aren’t saved in git (2 files), so updating by itself could lose them.',
      command: [
        'cd "C:\\Users\\ada\\conch"',
        'git stash',
        'git pull --ff-only',
        'git stash pop',
        'pnpm install',
      ].join('\n'),
    },
    action: undefined,
    footnote: 'Then restart Conch.',
  },
};

export const WentBack: Story = {
  name: 'Went back to the version you had',
  args: {
    notice: {
      tone: 'warning',
      message:
        'The update didn’t install (the new version wouldn’t build), so Conch went back to the version you had.',
    },
    action: <Button leadingIcon={<RefreshCw />}>Try again</Button>,
  },
};

export const RestartToFinish: Story = {
  args: {
    state: 'current',
    title: 'Restart Conch to finish',
    detail: 'The update is in. Stop Conch and run pnpm start, and it starts on the new version.',
    whatsNew,
    more: 0,
    action: undefined,
    footnote: undefined,
  },
};

export const JustUpdated: Story = {
  args: {
    state: 'current',
    title: 'Conch is up to date',
    detail: '0.2.0 · Updated just now',
    whatsNewLabel: 'What’s new in this update',
    defaultOpen: true,
    more: 0,
    action: undefined,
    footnote: undefined,
  },
};

export const CouldntCheck: Story = {
  args: {
    state: 'current',
    title: 'Conch is up to date',
    detail: 'Conch couldn’t reach the internet to check for updates. Checked 3 days ago.',
    whatsNew: [],
    action: undefined,
    footnote: undefined,
  },
};

export const NotAGitCheckout: Story = {
  args: {
    state: 'unavailable',
    title: 'Conch 0.2.0',
    detail:
      'Conch isn’t running from a folder it can update, so it can’t check for its own updates.',
    whatsNew: [],
    action: undefined,
    footnote: undefined,
  },
};

/** The programs Conch uses, in every state a row can be in. */
export const Programs: StoryObj<typeof ProgramUpdates.Item> = {
  render: () => (
    <ProgramUpdates aria-label="Programs Conch uses">
      <ProgramUpdates.Item
        name="Claude Code"
        version="2.1.284"
        state="current"
        status="Up to date"
      />
      <ProgramUpdates.Item
        name="Codex"
        version="0.159.0"
        state="available"
        action={
          <Button size="sm" variant="soft">
            Update to 0.160.0
          </Button>
        }
      />
      <ProgramUpdates.Item
        name="uv"
        version="0.8.3"
        state="updating"
        progress={{ value: 40, label: 'Downloading uv · 40%' }}
        status="Updating…"
      />
      <ProgramUpdates.Item name="1Password CLI" version="2.30.0" state="queued" status="Waiting…" />
      <ProgramUpdates.Item
        name="Docker"
        version="27.3.1"
        state="available"
        action={
          <Button asChild size="sm" variant="ghost" trailingIcon={<ArrowUpRight />}>
            <a href="https://www.docker.com/products/docker-desktop/">Get 27.4</a>
          </Button>
        }
        message="Docker updates as an administrator, so Conch can’t do it for you."
      />
      <ProgramUpdates.Item
        name="Node"
        version="24.21.0"
        state="failed"
        action={
          <Button size="sm" variant="soft" leadingIcon={<RotateCcw />}>
            Try again
          </Button>
        }
        message="Couldn’t download Node: the internet seems to be unreachable."
      />
      <ProgramUpdates.Item name="pnpm" version="12.7.0" state="updated" status="Updated just now" />
    </ProgramUpdates>
  ),
};

/** How Settings → Health puts it together. */
export const InSettings: Story = {
  render: () => (
    <Stack gap={4}>
      <Stack direction="row" align="center" justify="between" gap={3}>
        <Text size="sm" tone="subtle">
          Checked 2 hours ago
        </Text>
        <Button size="sm" variant="ghost" leadingIcon={<RefreshCw />}>
          Check now
        </Button>
      </Stack>
      <SoftwareUpdate
        state="available"
        title="An update is ready"
        detail="12 improvements · 0.2.0"
        whatsNew={whatsNew.slice(0, 4)}
        more={8}
        action={<Button leadingIcon={<RefreshCw />}>Update Conch</Button>}
        footnote="Conch restarts by itself when it’s done. Your chats are safe."
      />
      <Stack gap={2}>
        <Stack direction="row" align="center" justify="between">
          <Text size="sm" weight="medium">
            Programs Conch uses
          </Text>
          <Button size="sm" variant="ghost">
            Update all
          </Button>
        </Stack>
        <ProgramUpdates aria-label="Programs Conch uses">
          <ProgramUpdates.Item
            name="Claude Code"
            version="2.1.284"
            state="current"
            status="Up to date"
          />
          <ProgramUpdates.Item
            name="Codex"
            version="0.159.0"
            state="available"
            action={
              <Button size="sm" variant="soft">
                Update to 0.160.0
              </Button>
            }
          />
          <ProgramUpdates.Item
            name="uv"
            version="0.8.3"
            state="available"
            action={
              <Button size="sm" variant="soft">
                Update to 0.8.4
              </Button>
            }
          />
        </ProgramUpdates>
      </Stack>
      <Switch
        label="Keep the programs Conch uses up to date"
        description="Updates install by themselves overnight, when nothing is running. Conch itself always asks first, since it restarts."
      />
    </Stack>
  ),
};

export const StableBuild: Story = {
  args: { ...UpToDate.args, detail: 'v0.1.0 · Checked just now' },
};
export const BetaBuild: Story = {
  args: { ...UpToDate.args, detail: 'v0.1.0-beta.2 · Checked just now' },
};
export const AlphaBuild: Story = {
  args: { ...UpToDate.args, detail: 'v0.1.0-alpha.1 · Checked just now' },
};
