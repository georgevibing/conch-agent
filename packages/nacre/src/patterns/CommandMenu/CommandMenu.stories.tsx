import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Text } from '../../components/Text';
import { Composer } from '../Composer';
import { DemoToolbar } from '../ModelPicker/fixtures';
import { CommandMenu, useCommandMenu } from './CommandMenu';
import { commands } from './fixtures';

/** The wiring an app does: "/" at the start of the draft opens the menu. */
function SlashComposer({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const [last, setLast] = useState<string>();
  const slash = /^\/(\S*)$/.exec(value);
  const menu = useCommandMenu({
    items: commands,
    query: slash && !dismissed ? (slash[1] ?? '') : null,
    onSelect: (item) => {
      setLast(`/${item.name}`);
      setValue(item.argumentHint ? `/${item.name} ` : '');
    },
    onClose: () => setDismissed(true),
  });
  return (
    <div style={{ inlineSize: 'min(40rem, 90vw)', paddingBlockStart: '22rem' }}>
      <Composer
        value={value}
        onValueChange={(v) => {
          setValue(v);
          setDismissed(false);
        }}
        onSubmit={(v) => {
          setLast(v);
          setValue('');
        }}
        placeholder="Message Conch, or type / for commands"
        toolbar={<DemoToolbar />}
        onTextareaKeyDown={(e) => {
          menu.onKeyDown(e);
        }}
        textareaProps={menu.inputProps}
        overlay={<CommandMenu {...menu.menuProps} />}
      />
      <Text size="sm" tone="subtle" style={{ marginBlockStart: 12 }}>
        {last ? `Last action: ${last}` : 'Type / to see commands.'}
      </Text>
    </div>
  );
}

const meta = {
  title: 'Patterns/Chat/CommandMenu',
  component: CommandMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Type “/” at the start of the composer to find a command. Focus stays in the text field; arrows move, Enter or Tab picks, Escape closes. Matches rank by prefix, then substring, then keywords, then loose letters.',
      },
    },
  },
} satisfies Meta<typeof CommandMenu>;

export default meta;

export const InComposer: StoryObj = { render: () => <SlashComposer /> };

export const Open: StoryObj = { render: () => <SlashComposer initial="/" /> };

export const Filtered: StoryObj = { render: () => <SlashComposer initial="/re" /> };

export const NoMatch: StoryObj = { render: () => <SlashComposer initial="/zzz" /> };

export const KeyboardFlow: StoryObj = {
  tags: ['!autodocs'],
  render: () => <SlashComposer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox');
    await userEvent.click(field);
    await userEvent.keyboard('/mo');
    await expect(canvas.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByText('Last action: /model')).toBeVisible();
  },
};
