import type { Meta, StoryObj } from '@storybook/react-vite';

import { BackupPowers } from './BackupPowers';
import { onePower, powers } from './fixtures';

const meta = {
  title: 'Patterns/Backups/BackupPowers',
  component: BackupPowers,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What in a backup can act for you, shown in the restore preview before anyone says yes — read from the files in it, never from what it says it holds. One calm list, hard to miss: a program it runs on this computer (with the command, as it would run), and anything set to act without asking first. It ends with what to do: restore it only if you set these up yourself. With nothing to say, it shows nothing.',
      },
    },
  },
  args: { powers },
  decorators: [(Story) => <div style={{ maxInlineSize: 440 }}>{Story()}</div>],
} satisfies Meta<typeof BackupPowers>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One of each: a program, integrations and tools that don't ask, Full trust, a routine, the browser, the terminal. */
export const Everything: Story = {};

/** The usual case for your own backup: one program you added yourself. */
export const OneProgram: Story = { args: { powers: onePower } };

/** More than the preview lists: the rest are counted. */
export const More: Story = { args: { powers: powers.slice(0, 3), more: 12 } };

/** A long command wraps rather than hides. */
export const LongCommand: Story = {
  args: {
    powers: [
      {
        kind: 'runs-program',
        name: 'Home Assistant',
        command:
          'uvx --from git+https://github.com/someone/home-assistant-mcp@main home-assistant-mcp --token-file "/Users/ada/Library/Application Support/ha/token" --verbose',
      },
    ],
  },
};

/** Nothing that acts for you: nothing at all. */
export const Nothing: Story = { args: { powers: [] } };

export const Narrow: Story = {
  decorators: [(Story) => <div style={{ maxInlineSize: 300 }}>{Story()}</div>],
};
