import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, GitBranch, Pencil, Quote, RotateCcw, Trash2 } from 'lucide-react';

import { ContextMenu } from './ContextMenu';
import styles from './ContextMenu.module.css';

const meta = {
  title: 'Components/Overlays/ContextMenu',
  parameters: {
    docs: {
      description: {
        component:
          'Right-click (or long-press) menu sharing all parts and the gliding highlight with DropdownMenu.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MessageActions: Story = {
  render: () => (
    <ContextMenu.Root>
      <ContextMenu.Trigger className={styles.area}>Right-click this message</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item icon={<Copy />} shortcut="mod+c">
          Copy
        </ContextMenu.Item>
        <ContextMenu.Item icon={<Quote />}>Quote in reply</ContextMenu.Item>
        <ContextMenu.Item icon={<Pencil />}>Edit and resend</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item icon={<RotateCcw />}>Retry from here</ContextMenu.Item>
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger icon={<GitBranch />}>Branch</ContextMenu.SubTrigger>
          <ContextMenu.SubContent>
            <ContextMenu.Item>New session from here</ContextMenu.Item>
            <ContextMenu.Item>Fork into worktree</ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
        <ContextMenu.Separator />
        <ContextMenu.Item icon={<Trash2 />} tone="danger">
          Delete message
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  ),
};
