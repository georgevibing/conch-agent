import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRight, Download, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { SetupChecklist, type SetupStepState } from './SetupChecklist';

const meta = {
  title: 'Patterns/Setup/SetupChecklist',
  component: SetupChecklist.Step,
  parameters: {
    docs: {
      description: {
        component:
          'What something needs before it can work — an app, a program, a switch in another app — as a short list that fills in by itself. Conch offers to install what it can, links to what it can’t, and notices when a step is done: nobody presses “Try again”. Only the current step asks for attention, with at most one button.',
      },
    },
  },
  args: {
    state: 'current',
    title: '1Password’s MCP server',
    description: 'Comes with the 1Password app.',
    note: 'Ready',
    progress: { value: 42, label: 'Downloading 1Password · 42%' },
  },
  argTypes: {
    state: {
      control: 'select',
      options: ['done', 'current', 'waiting', 'working', 'failed', 'unavailable'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '28rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SetupChecklist.Step>;

export default meta;
type Story = StoryObj<typeof meta>;

const steps = (
  <ol>
    <li>In 1Password, open Settings → Labs and turn on “Enable local MCP server”.</li>
    <li>In Settings → Developer, turn on “Integrate with MCP clients”.</li>
  </ol>
);

const label = 'What 1Password needs';

export const Playground: Story = {
  render: (args) => (
    <SetupChecklist aria-label={label}>
      <SetupChecklist.Step state="done" title="The 1Password app" note="Installed" />
      <SetupChecklist.Step
        {...args}
        action={
          <Button size="sm" variant="surface" leadingIcon={<Download />}>
            Install 1Password
          </Button>
        }
      />
    </SetupChecklist>
  ),
};

/** Nothing installed yet, and Conch can install it (winget, Homebrew). */
export const CanInstall: Story = {
  render: () => (
    <SetupChecklist aria-label={label}>
      <SetupChecklist.Step
        state="current"
        title="The 1Password app"
        description="Conch can install it for you. It takes a minute or two."
      />
      <SetupChecklist.Step
        state="waiting"
        title="1Password’s MCP server"
        description="Comes with the app."
      />
      <SetupChecklist.Step state="waiting" title="Turned on in 1Password" />
    </SetupChecklist>
  ),
};

/** Installing, with the installer's own progress. */
export const Installing: Story = {
  render: () => (
    <SetupChecklist aria-label={label}>
      <SetupChecklist.Step
        state="working"
        title="The 1Password app"
        progress={{ value: 64, label: 'Downloading 1Password · 64%' }}
      />
      <SetupChecklist.Step state="working" title="1Password’s MCP server" />
      <SetupChecklist.Step state="waiting" title="Turned on in 1Password" />
    </SetupChecklist>
  ),
};

/** Everything's installed; one switch only a person can flip. Conch notices when it's on. */
export const SwitchInAnotherApp: Story = {
  render: () => (
    <SetupChecklist aria-label={label}>
      <SetupChecklist.Step state="done" title="The 1Password app" note="Installed" />
      <SetupChecklist.Step state="done" title="1Password’s MCP server" note="Ready" />
      <SetupChecklist.Step
        state="current"
        title="Turn it on in 1Password"
        description={steps}
        action={
          <Button size="sm" variant="surface" trailingIcon={<ExternalLink />}>
            Open 1Password
          </Button>
        }
      />
    </SetupChecklist>
  ),
};

/** Conch can't install it here: one link, then it notices by itself. */
export const LinkOnly: Story = {
  render: () => (
    <SetupChecklist aria-label={label}>
      <SetupChecklist.Step
        state="failed"
        title="The 1Password app"
        description="Couldn’t download 1Password: the internet seems to be unreachable."
        action={
          <Button size="sm" variant="surface" trailingIcon={<ArrowUpRight />}>
            Get 1Password
          </Button>
        }
      />
      <SetupChecklist.Step
        state="unavailable"
        title="Browser extension"
        description="Not made for this computer yet."
      />
    </SetupChecklist>
  ),
};

/** The whole thing, playing out: install, then the switch, then done. */
export const LiveInstall: Story = {
  render: function Live() {
    const [t, setT] = useState(0);
    useEffect(() => {
      const id = setInterval(() => setT((v) => (v >= 14 ? 0 : v + 1)), 450);
      return () => clearInterval(id);
    }, []);
    const pct = Math.min(100, t * 12);
    const app: SetupStepState = t === 0 ? 'current' : t < 9 ? 'working' : 'done';
    return (
      <Stack gap={3}>
        <SetupChecklist aria-label={label}>
          <SetupChecklist.Step
            state={app}
            title="The 1Password app"
            note="Installed"
            description="Conch can install it for you."
            progress={{ value: pct, label: `Downloading 1Password · ${pct}%` }}
          />
          <SetupChecklist.Step
            state={app === 'done' ? (t < 12 ? 'current' : 'done') : 'waiting'}
            title="Turn it on in 1Password"
            note="On"
            description={steps}
          />
        </SetupChecklist>
      </Stack>
    );
  },
};
