import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { modes } from '../ModelPicker/fixtures';
import { ModeChoice } from './ModeChoice';

function Stateful({ initial = 'default' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ModeChoice
      options={modes}
      value={value}
      onValueChange={setValue}
      aria-label="How much Pearl can do on its own"
      name="Pearl"
    />
  );
}

const meta = {
  title: 'Patterns/Settings/ModeChoice',
  component: ModeChoice,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The default permission mode on a settings page. The same options as the chat’s `ModePicker` — one definition, the same icons, names and lines — as calm cards from Plan only to Full trust. Each icon wears the tone the chat’s chip does, so a trusting mode looks armed in both places; choosing Full trust asks once, right under the list, before it’s saved.',
      },
    },
  },
  args: { options: modes, value: 'default', onValueChange: () => {}, 'aria-label': 'Default mode' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '36rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModeChoice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Stateful /> };

/** Auto chosen: it gets on with the work and stops only for something serious. */
export const AutoChosen: Story = { render: () => <Stateful initial="auto" /> };

/** Full trust chosen: the card takes the danger tone. */
export const FullTrustChosen: Story = { render: () => <Stateful initial="bypassPermissions" /> };

/** A provider that offers fewer modes shows only those. */
export const FewerModes: Story = {
  render: () => (
    <ModeChoice
      options={modes.filter((m) => m.value === 'default' || m.value === 'plan')}
      value="default"
      onValueChange={() => {}}
      aria-label="Default mode"
    />
  ),
};
