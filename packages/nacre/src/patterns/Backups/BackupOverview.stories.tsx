import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { BackupOverview } from './BackupOverview';

const actions = (
  <>
    <Button size="sm" leadingIcon={<Download />}>
      Back up now
    </Button>
    <Button size="sm" variant="surface" leadingIcon={<Upload />}>
      Restore from a file…
    </Button>
  </>
);

const meta = {
  title: 'Patterns/Backups/BackupOverview',
  component: BackupOverview,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Where backups stand, at a glance, the way a phone says it: “Backed up automatically · Last backup today at 3:12 AM”, with the one switch that matters and the two things a person does here. A missed backup says why in one calm sentence; Conch tries again by itself.',
      },
    },
  },
  args: {
    automatic: true,
    detail: 'Last backup today at 3:12 AM · 9 kept · 312 MB',
    children: actions,
    onAutomaticChange: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof BackupOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [automatic, setAutomatic] = useState(args.automatic);
    return (
      <BackupOverview
        {...args}
        automatic={automatic}
        onAutomaticChange={setAutomatic}
        detail={
          automatic ? args.detail : 'Turn it on to keep a copy of your Conch every day, here.'
        }
      />
    );
  },
};

export const BackedUp: Story = {};

export const FirstBackupSoon: Story = {
  args: { detail: 'The first backup is made soon, while Conch isn’t busy.' },
};

export const BackingUp: Story = { args: { state: 'running', detail: 'Backing up now…' } };

export const NoRoom: Story = {
  args: {
    state: 'problem',
    detail:
      'There isn’t enough free space on this computer for a backup. Free up some space and Conch will try again.',
  },
};

export const Off: Story = {
  args: {
    automatic: false,
    detail: 'Turn it on to keep a copy of your Conch every day, here.',
  },
};

/** At phone width the actions share the row. */
export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};
