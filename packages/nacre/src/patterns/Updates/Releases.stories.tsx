import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { ReleaseChannelPicker, type ReleaseChannelValue } from './ReleaseChannelPicker';
import { ReleaseNotes, type ReleaseNoteItem } from './ReleaseNotes';
import { SoftwareUpdate } from './SoftwareUpdate';
import { UpdateBanner } from './UpdateBanner';

const releases: ReleaseNoteItem[] = [
  {
    version: '0.4.0',
    date: '14 October',
    headsUp: ['Sign in again on your phone: Conch asks once after this update'],
    new: ['Edit pages by hand, with a live preview', 'Connect Teams, Matrix and WeChat'],
    better: ['Search finds what you meant, not only what you typed'],
    fixed: ['The editor keeps its buttons together on a phone'],
  },
  {
    version: '0.3.0',
    date: '2 October',
    new: ['Link WhatsApp and Signal by scanning a code', 'Connect iMessage and email'],
    fixed: ['On a mail server of your own, sign-in proof comes from your Sent mail'],
  },
];

const meta = {
  title: 'Patterns/Updates/ReleaseNotes',
  component: ReleaseNotes,
  parameters: {
    docs: {
      description: {
        component:
          'What a release brings, in its own few lines, from your side: Heads up (what you must do, with an icon and words, never colour alone), then New, Better and Fixed. Several releases behind, each version’s notes are listed newest first; the newest is open and the others fold away. The notes come from the release’s signed tag, so they’re exactly what was released.',
      },
    },
  },
  args: { releases },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 'min(36rem, calc(100vw - 2rem))' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReleaseNotes>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const OneRelease: Story = { args: { releases: releases.slice(1) } };

export const SeveralBehind: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Edit pages by hand, with a live preview')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: /Conch 0\.3/ }));
    await expect(await canvas.findByText('Connect iMessage and email')).toBeVisible();
  },
};

export const HeadsUpOnly: Story = {
  args: {
    releases: [
      { version: '1.0.0', headsUp: ['Conch needs Node.js 26: the installer gets it for you'] },
    ],
  },
};

/** The banner at the top of the app: said once per release, put away with ✕. */
export const Banner: Story = {
  render: () => {
    const [shown, setShown] = useState(true);
    return shown ? (
      <UpdateBanner
        title="Conch 0.4 is ready"
        onWhatsNew={() => {}}
        onUpdate={() => {}}
        onDismiss={() => setShown(false)}
      />
    ) : (
      <Button size="sm" variant="ghost" onClick={() => setShown(true)}>
        Show it again
      </Button>
    );
  },
};

export const BannerOnAPhone: Story = {
  ...Banner,
  decorators: [
    (Story) => (
      <div style={{ inlineSize: '20rem' }}>
        <Story />
      </div>
    ),
  ],
};

/** Which releases Conch gets: stable unless you choose otherwise. */
export const Channels: Story = {
  render: () => {
    const [value, setValue] = useState<ReleaseChannelValue>('beta');
    return (
      <ReleaseChannelPicker
        value={value}
        onValueChange={setValue}
        note={
          value === 'stable'
            ? 'You’re on 0.4.0-beta.2. Conch moves to stable releases with the next one after it (0.4.0 or later): it never goes back a version by itself.'
            : undefined
        }
      />
    );
  },
};

/** Settings → Health → Updates, with a release waiting. */
export const Composed: Story = {
  render: () => (
    <Stack gap={4}>
      <UpdateBanner
        title="Conch 0.4 is ready"
        onWhatsNew={() => {}}
        onUpdate={() => {}}
        onDismiss={() => {}}
      />
      <SoftwareUpdate
        state="available"
        title="Conch 0.4 is ready"
        detail="You have 0.2.0 · Checked 2 hours ago"
        defaultOpen
        notes={<ReleaseNotes releases={releases} />}
        action={<Button leadingIcon={<RefreshCw />}>Update Conch</Button>}
        footnote="Conch gets it ready while you keep working, then restarts in a few seconds. Your chats are safe."
      />
      <ReleaseChannelPicker value="stable" onValueChange={() => {}} />
    </Stack>
  ),
};
