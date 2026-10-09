import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { claudeCode, connectedProviders, efforts, modes } from '../ModelPicker/fixtures';
import { places } from '../WorkPlaces/fixtures';
import { Composer } from './Composer';
import { ComposerSettings, type ComposerSettingsProps } from './ComposerSettings';

/** As the app wires it: every choice kept, and the defaults it can save. */
function Stateful({
  withPlaces = false,
  ...props
}: Partial<ComposerSettingsProps> & { withPlaces?: boolean }) {
  const [model, setModel] = useState(props.model ?? 'opus');
  const [effort, setEffort] = useState(props.effort ?? 'auto');
  const [fast, setFast] = useState(props.fastMode ?? false);
  const [mode, setMode] = useState(props.mode ?? 'auto');
  const [place, setPlace] = useState(props.place?.value ?? 'computer');
  const [defaults, setDefaults] = useState({ model, effort, fast, mode, place });
  return (
    <ComposerSettings
      providers={[claudeCode]}
      efforts={model === 'haiku' ? [] : efforts}
      modes={modes}
      name="Pearl"
      folder={{ name: 'conch', path: '~/projects/conch', onChoose: fn() }}
      {...props}
      model={model}
      onModelChange={setModel}
      effort={effort}
      onEffortChange={setEffort}
      fastMode={fast}
      // Only Opus has fast mode here: choose Sonnet and the switch goes.
      fastModeAvailable={model === 'opus'}
      onFastModeChange={setFast}
      mode={mode}
      onModeChange={setMode}
      {...(withPlaces && { place: { options: places, value: place, onValueChange: setPlace } })}
      isDefault={
        defaults.model === model &&
        defaults.effort === effort &&
        defaults.fast === fast &&
        defaults.mode === mode &&
        defaults.place === place
      }
      onMakeDefault={() => setDefaults({ model, effort, fast, mode, place })}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/ComposerSettings',
  component: ComposerSettings,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The composer’s one settings chip. It reads as the model and the mode (“Opus · Auto”) and opens one panel with everything about the next turn: the model (searchable, with More models), Thinking, Fast mode when the model has it, the Mode, Where work runs once there is somewhere else, the Folder, and one Make this my default. In a tight toolbar the model’s name gives way first; the mode is always read in full, and a trusting mode tints the whole chip. On a phone the panel rises as a sheet.',
      },
    },
  },
  args: {
    providers: [claudeCode],
    model: 'opus',
    onModelChange: fn(),
    efforts,
    effort: 'auto',
    onEffortChange: fn(),
    fastMode: false,
    fastModeAvailable: true,
    onFastModeChange: fn(),
    modes,
    mode: 'auto',
    onModeChange: fn(),
    isDefault: false,
  },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: '34rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComposerSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: (args) => <Stateful {...args} /> };

export const Open: Story = { render: (args) => <Stateful {...args} open /> };

/** Opened from `/mode` or ⌘K: the chosen mode takes focus. */
export const OpenAtMode: Story = {
  name: 'Opened at the mode',
  render: (args) => <Stateful {...args} open focus="mode" />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const modeList = within(await body.findByRole('radiogroup', { name: 'Mode' }));
    await expect(modeList.getByRole('radio', { name: /^Auto/ })).toHaveFocus();
  },
};

/** A model without fast mode: there's no switch at all, not a greyed one. */
export const NoFastMode: Story = {
  name: 'A model without fast mode',
  render: (args) => <Stateful {...args} model="sonnet" open />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByRole('radiogroup', { name: 'Model' });
    await expect(body.queryByRole('switch', { name: /Fast mode/ })).toBeNull();
  },
};

export const FastAndThinking: Story = {
  name: 'Fast mode on, thinking hard',
  render: (args) => <Stateful {...args} fastMode effort="max" open />,
};

export const WhereWorkRuns: Story = {
  name: 'With somewhere else to run',
  render: (args) => (
    <Stateful
      {...args}
      withPlaces
      place={{ options: places, value: 'container', onValueChange: fn() }}
      open
    />
  ),
};

export const FullTrust: Story = {
  name: 'Full trust (armed)',
  render: (args) => <Stateful {...args} mode="bypassPermissions" />,
};

/** Switching into Full trust asks again, in place of the list. */
export const ConfirmFullTrust: Story = {
  tags: ['!autodocs'],
  render: (args) => <Stateful {...args} open focus="mode" />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const modeList = within(await body.findByRole('radiogroup', { name: 'Mode' }));
    await userEvent.click(modeList.getByRole('radio', { name: /Full trust/ }));
    await expect(body.getByRole('alertdialog')).toHaveTextContent(/run anything without asking/);
    await expect(body.queryByRole('button', { name: /Make this my default/ })).toBeNull();
  },
};

export const EveryProvider: Story = {
  name: 'Every connected provider',
  render: (args) => <Stateful {...args} providers={connectedProviders} open />,
};

export const AsSheet: Story = {
  name: 'On a phone (sheet)',
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (args) => <Stateful {...args} sheet withPlaces />,
};

/** In the composer, beside the folder it replaces and the meters that stay. */
export const InComposer: Story = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => <Composer onSubmit={fn()} onFiles={fn()} toolbar={<Stateful {...args} />} />,
};
