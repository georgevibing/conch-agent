import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { PathPicker } from './PathPicker';

const meta = {
  title: 'Patterns/PathPicker',
  component: PathPicker,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Choosing a file or folder without typing a path: what Conch found, one click each; the system’s own Open dialog for anything else; typing only as a last resort, from another device where no dialog can show.',
      },
    },
  },
  args: { label: 'KeePassXC database', onChange: () => undefined },
} satisfies Meta<typeof PathPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function Live(props: Partial<Parameters<typeof PathPicker>[0]>) {
  const [value, setValue] = useState(props.value);
  return (
    <div style={{ maxInlineSize: 420 }}>
      <PathPicker label="KeePassXC database" {...props} value={value} onChange={setValue} />
    </div>
  );
}

/** Found on this computer: one click. Anything else: the Open dialog. */
export const FoundFiles: Story = {
  render: () => (
    <Live
      value="/Users/ada/Documents/Passwords.kdbx"
      suggestions={[
        {
          path: '/Users/ada/Documents/Passwords.kdbx',
          title: 'Passwords',
          detail: 'Documents · opened lately in KeePassXC',
        },
        {
          path: '/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/Family.kdbx',
          title: 'Family',
          detail: 'iCloud Drive',
        },
      ]}
      onChoose={() => new Promise((r) => setTimeout(() => r('/Volumes/USB/Work.kdbx'), 600))}
    />
  ),
};

/** A folder, with Conch's own as the first choice. */
export const Folder: Story = {
  render: () => (
    <Live
      kind="folder"
      value="/Users/ada/.conch/workspace"
      suggestions={[
        {
          path: '/Users/ada/.conch/workspace',
          title: 'Conch’s own workspace',
          detail: 'A folder just for your assistant',
        },
      ]}
      onChoose={() => Promise.resolve('/Users/ada/Projects/site')}
    />
  ),
};

/** From another device: no dialog can show here, so typing is the way. */
export const OnAnotherDevice: Story = {
  render: () => <Live placeholder="~/Documents/Passwords.kdbx" />,
};
