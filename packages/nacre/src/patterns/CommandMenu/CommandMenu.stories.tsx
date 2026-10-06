import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Text } from '../../components/Text';
import { DemoToolbar } from '../ModelPicker/fixtures';
import { CommandMenu } from './CommandMenu';
import { SlashComposer } from './fixtures';

/** The composer as an app wires it, with the last thing it did said underneath. */
function Demo({ initial = '' }: { initial?: string }) {
  const [last, setLast] = useState<string>();
  return (
    <div style={{ inlineSize: 'min(40rem, 90vw)', paddingBlockStart: '24rem' }}>
      <SlashComposer
        initial={initial}
        onAction={setLast}
        onSubmit={setLast}
        toolbar={<DemoToolbar />}
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
          'Type “/” at the start of the composer to find a command. Focus stays in the text field; arrows move, Enter or Tab picks, Escape closes. Matches rank by prefix, then a word inside the name, then substring, then keywords, then loose letters. A command with values (`/effort`, `/model`) goes on to them in the same menu, the one in use marked “Current” and selected first; the back arrow returns to every command. On a phone it is a sheet above the keyboard: rows for a thumb, descriptions on their own line, and a close button instead of Escape. Nothing depends on hover.',
      },
    },
  },
} satisfies Meta<typeof CommandMenu>;

export default meta;

export const InComposer: StoryObj = { render: () => <Demo /> };

export const Open: StoryObj = { render: () => <Demo initial="/" /> };

export const Filtered: StoryObj = { render: () => <Demo initial="/re" /> };

export const NoMatch: StoryObj = { render: () => <Demo initial="/zzz" /> };

/** `/effort `: the thinking levels, the current one ticked and selected first. */
export const Values: StoryObj = { render: () => <Demo initial="/effort " /> };

/** `/model `: models from every provider, by the name people read, grouped by provider. */
export const Models: StoryObj = { render: () => <Demo initial="/model " /> };

/** A phone: a sheet the width of the composer, thumb-sized rows, and a close button. */
export const Phone: StoryObj = {
  render: () => <Demo initial="/" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const KeyboardFlow: StoryObj = {
  tags: ['!autodocs'],
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox');
    await userEvent.click(field);
    await userEvent.keyboard('/eff');
    await expect(canvas.getByRole('listbox', { name: 'Commands' })).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('listbox', { name: 'effort values' })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(canvas.getByText('Last action: /effort max')).toBeVisible();
  },
};
