import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Archive,
  Bot,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  FolderInput,
  Globe,
  MoreHorizontal,
  Pencil,
  Pin,
  Route,
  Share2,
  SquareTerminal,
  TextSearch,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { DropdownMenu } from './DropdownMenu';

const meta = {
  title: 'Components/Overlays/DropdownMenu',
  parameters: {
    docs: {
      description: {
        component:
          'Action menu with full keyboard support. A single highlight wash glides between items on a spring as you move with the pointer or arrow keys. A submenu opens beside the menu with a pointer; on a phone or a touch screen (`submenus="auto"`, the default) the same menu slides over to it, with a back row at its top: Left or Escape goes back, the height follows, and reduced motion swaps it at once.',
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

const AGENTS = ['Conch', 'Scout', 'Ledger', 'Quill'];

/** A chat's header "More" menu on a phone, the menu that has a choice nested in it. */
function ChatMore({
  defaultOpen,
  submenus,
}: {
  defaultOpen?: boolean;
  submenus?: 'auto' | 'side' | 'drill';
}) {
  const [agent, setAgent] = useState('Conch');
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="More" variant="surface">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" submenus={submenus}>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger icon={<Bot />}>Answering: {agent}</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent backLabel="Answering">
            <DropdownMenu.RadioGroup value={agent} onValueChange={setAgent}>
              {AGENTS.map((name) => (
                <DropdownMenu.RadioItem key={name} value={name}>
                  {name}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Item icon={<TextSearch />}>Find in chat</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Route />}>How it did it</DropdownMenu.Item>
        <DropdownMenu.Item icon={<Globe />}>Show the browser</DropdownMenu.Item>
        <DropdownMenu.Item icon={<SquareTerminal />}>Show the terminal</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/**
 * On a phone a submenu doesn't open beside the menu, where there's no room:
 * the same menu slides over to it, its height following, with a back row at
 * its top. Press "Answering" to go in, the back row (or Left, or Escape) to
 * come out.
 */
export const DrillInOnAPhone: Story = {
  render: () => (
    <div style={{ blockSize: 340, display: 'flex', justifyContent: 'flex-end' }}>
      <ChatMore submenus="drill" defaultOpen />
    </div>
  ),
};

/** The same menu opened at its nested level, as a picture. */
export const DrillInOpened: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 340, display: 'flex', justifyContent: 'flex-end' }}>
      <ChatMore submenus="drill" defaultOpen />
    </div>
  ),
  play: async () => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole('menuitem', { name: /Answering/ }));
    await expect(body.getAllByRole('menu')).toHaveLength(1);
    await waitFor(() =>
      expect(body.getByRole('menuitem', { name: 'Back from Answering' })).toBeVisible(),
    );
  },
};

/** Keyboard: Right or Enter goes in, Left or Escape comes back to the row that opened it. */
export const DrillInKeyboard: Story = {
  tags: ['!autodocs'],
  render: () => (
    <div style={{ blockSize: 340, display: 'flex', justifyContent: 'flex-end' }}>
      <ChatMore submenus="drill" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'More' }).focus();
    await userEvent.keyboard('{Enter}');
    const body = within(document.body);
    const trigger = await body.findByRole('menuitem', { name: /Answering/ });
    await expect(trigger).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(body.getByRole('menuitemradio', { name: 'Conch' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(body.getByRole('menuitem', { name: /Answering/ })).toHaveFocus();
  },
};
