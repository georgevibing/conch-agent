import type { Meta, StoryObj } from '@storybook/react-vite';

import { BackupList } from './BackupList';
import { backups } from './fixtures';

const meta = {
  title: 'Patterns/Backups/BackupList',
  component: BackupList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The backups Conch keeps on this computer, newest first: seven days, then four weeks. Each row says when in plain words and what it holds, with **Restore…** and a quiet download. The copy made just before a restore says what it is; it never leaves this computer, so it has no download.',
      },
    },
  },
  args: {
    backups,
    onRestore: () => undefined,
    onDownload: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof BackupList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const OneBackup: Story = { args: { backups: backups.slice(0, 1) } };

/** None yet: a short line, since the overview above says when the first is made. */
export const Empty: Story = { args: { backups: [] } };

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 340 }}>{Story()}</div>],
};
