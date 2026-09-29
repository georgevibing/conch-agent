import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Archive,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  Share2,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { DropdownMenu } from './DropdownMenu';

const meta = {
  title: 'Components/Overlays/DropdownMenu',
  parameters: {
    docs: {
      description: {
        component:
          'Action menu with full keyboard support. A single highlight wash glides between items on a spring as you move with the pointer or arrow keys.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function SessionActions({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Session actions" variant="surface">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={<Pencil />} shortcut="mod+r">
          Rename
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<Pin />}>Pin to sidebar</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Copy />} shortcut="mod+shift+c">
          Copy transcript
        </DropdownMenu.Item>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={<Share2 />}>Export</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            <DropdownMenu.Item icon={<Download />}>Markdown</DropdownMenu.Item>
            <DropdownMenu.Item icon={<Download />}>JSON</DropdownMenu.Item>
            <DropdownMenu.Item icon={<Download />}>HTML</DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Item icon={<FolderInput />} disabled>
          Move to project…
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={<Archive />}>Archive</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Trash2 />} tone="danger" shortcut="mod+backspace">
          Delete session
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export const SessionActionsMenu: Story = {
  name: 'Session actions',
  render: () => <SessionActions />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 380, paddingBlockStart: 8 }}>
      <SessionActions defaultOpen />
    </div>
  ),
};

function ModelMenu({ defaultOpen }: { defaultOpen?: boolean }) {
  const [model, setModel] = useState('opus');
  const [thinking, setThinking] = useState(true);
  const [autoAccept, setAutoAccept] = useState(false);
  const names: Record<string, string> = {
    opus: 'Opus 5.5',
    sonnet: 'Sonnet 5',
    haiku: 'Haiku 4.5',
  };
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="sm" leadingIcon={<Cpu />} trailingIcon={<ChevronDown />}>
          {names[model]}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Label>Model</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={model} onValueChange={setModel}>
          <DropdownMenu.RadioItem value="opus" trailing="Deepest">
            Opus 5.5
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="sonnet" trailing="Balanced">
            Sonnet 5
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="haiku" trailing="Fastest">
            Haiku 4.5
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Label>Behaviour</DropdownMenu.Label>
        <DropdownMenu.CheckboxItem checked={thinking} onCheckedChange={setThinking}>
          Extended thinking
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.CheckboxItem
          checked={autoAccept}
          onCheckedChange={setAutoAccept}
          shortcut="shift+tab"
        >
          Auto-accept edits
        </DropdownMenu.CheckboxItem>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export const CheckboxAndRadio: Story = {
  render: () => <ModelMenu />,
};

export const OpenSelection: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 320, paddingBlockStart: 8 }}>
      <ModelMenu defaultOpen />
    </div>
  ),
};

export const KeyboardNavigation: Story = {
  tags: ['!autodocs'],
  render: () => <SessionActions />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Session actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = await within(document.body).findByRole('menu');
    await expect(menu).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect(within(menu).getByRole('menuitem', { name: /Copy transcript/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
  },
};
