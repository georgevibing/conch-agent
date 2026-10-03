import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { AppVersions } from './AppVersions';
import { versions } from './fixtures';
import { ShareSteps } from './ShareSteps';

const meta = {
  title: 'Patterns/Conch apps/Share',
  component: ShareSteps,
  args: {
    name: 'Plant diary',
    appId: 'plant-diary',
    state: { state: 'idle' },
    onPublish: fn(),
    onSaveFile: fn(),
    onInstall: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Sharing an app is one press (ADR 0061): **Publish on GitHub** or **Save as a file**, each with a sentence. Publishing walks through what only the person can do — install GitHub’s app, sign in with a code — and carries on by itself, then gives the address anyone with Conch can add it from. Either way the package carries their signature.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShareSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const NeedsGitHubsApp: Story = {
  args: { state: { state: 'needs-program', need: 'gh' } },
};

export const SignIn: Story = {
  args: {
    state: { state: 'needs-sign-in', code: 'B1C2-D3E4', url: 'https://github.com/login/device' },
  },
};

export const Publishing: Story = {
  args: { state: { state: 'publishing', step: 'Making the release v1.2.0' } },
};

export const Published: Story = {
  args: {
    state: { state: 'published', url: 'https://github.com/ada/plant-diary', version: '1.2.0' },
  },
};

export const Failed: Story = {
  args: {
    state: {
      state: 'failed',
      message:
        'You already have a repository called plant-diary. Rename it on GitHub, then try again.',
    },
  },
};

/** Someone else made it: the address it came from, and the file. Only its maker publishes it. */
export const FromSomeoneElse: Story = {
  args: { elsewhere: { url: 'https://github.com/ada/plant-diary' } },
};

/** From a file: nothing to point at, so the file is the way. */
export const FromAFile: Story = {
  args: { elsewhere: {} },
};

/** The versions kept, each with Go back. */
export const Versions: Story = {
  render: () => {
    const now = Date.UTC(2026, 9, 3);
    const [current, ...earlier] = versions(now);
    return (
      <AppVersions
        name="Plant diary"
        current={{ version: current?.version ?? '1.2.0', at: current?.at ?? now }}
        versions={earlier}
        onGoBack={fn()}
      />
    );
  },
};

export const VersionsGoingBack: Story = {
  render: () => {
    const now = Date.UTC(2026, 9, 3);
    const [current, ...earlier] = versions(now);
    return (
      <AppVersions
        name="Plant diary"
        current={{ version: current?.version ?? '1.2.0', at: current?.at ?? now }}
        versions={earlier}
        onGoBack={fn()}
        busy="1.1.0"
      />
    );
  },
};

export const VersionsNoneYet: Story = {
  render: () => (
    <AppVersions
      name="Plant diary"
      current={{ version: '1.0.0', at: Date.UTC(2026, 9, 1) }}
      versions={[]}
      onGoBack={fn()}
    />
  ),
};
