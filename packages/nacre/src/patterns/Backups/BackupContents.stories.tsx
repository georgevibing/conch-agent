import type { Meta, StoryObj } from '@storybook/react-vite';

import { BackupContents } from './BackupContents';
import { daily, everything, light } from './fixtures';

const meta = {
  title: 'Patterns/Backups/BackupContents',
  component: BackupContents,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What a restore brings back, before anything happens, in the words a person would use: “12 memories · 3 routines · 5 integrations, you’ll sign in to them again · 240 chats”. What a backup doesn’t hold says that yours stays as it is.',
      },
    },
  },
  args: { contents: everything },
  decorators: [(Story) => <div style={{ maxInlineSize: 440 }}>{Story()}</div>],
} satisfies Meta<typeof BackupContents>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Everything, keys and sign-ins included (the passphrase unlocks them). */
export const Everything: Story = {};

/** A daily backup: keys stay on this computer, so integrations that sign in ask again. */
export const Daily: Story = { args: { contents: daily } };

/** No chats, no keys: both stay as they are. */
export const WithoutChatsOrKeys: Story = { args: { contents: light } };

/** The keys are in it, but left out (a forgotten passphrase). */
export const KeysLeftOut: Story = { args: { withSecrets: false } };

/** The copy Conch kept just before a restore. */
export const UndoCopy: Story = { args: { contents: { ...everything, secrets: 'local' } } };
