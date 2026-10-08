import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { Story as StoryRow } from '../Story/Story';
import { notReady, places, withSetup } from './fixtures';
import { WorkedAt } from './WorkedAt';
import { WorkPlacePicker, type WorkPlaceOption } from './WorkPlacePicker';

function Stateful({
  initial = 'computer',
  open,
  options = places,
  note,
}: {
  initial?: string;
  open?: boolean;
  options?: WorkPlaceOption[];
  note?: string;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState('computer');
  return (
    <WorkPlacePicker
      options={options}
      value={value}
      onValueChange={setValue}
      isDefault={value === saved}
      onMakeDefault={() => setSaved(value)}
      {...(open !== undefined && { open })}
      {...(note && { note })}
    />
  );
}

const meta = {
  title: 'Patterns/Chat/WorkPlacePicker',
  component: WorkPlacePicker,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Where the chat’s work runs (ADR 0106): this computer’s sealed box, a container, a machine of yours over SSH, or a sandbox in the cloud. A calm chip beside the mode whose mark is the place. When the place changes the new mark glides up into the chip on a spring, with one glint, as if the work had just moved there (reduced motion: it simply changes). A place that isn’t ready wears a small dot — breathing while it gets ready. A place that needs setting up (a key, Docker or Podman) isn’t chosen: its row says what it needs and, in a few quiet words, the next step (“Add a key →”), and pressing the row takes the person to Settings with the box to type in ready. No button, nothing filled. When the chat’s provider runs its own commands here whatever is chosen, the list says so first, plainly.',
      },
    },
  },
  args: { options: places, value: 'computer', onValueChange: () => {}, isDefault: true },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: '30rem' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkPlacePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: () => <Stateful /> };

export const Open: Story = { render: () => <Stateful open /> };

export const InAContainer: Story = { render: () => <Stateful initial="container" /> };

/** Moving the work: pick another place and watch the chip's mark arrive. */
export const Moving: Story = {
  render: () => <Stateful />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: /Where work runs: This computer/ }));
    await userEvent.click(await page.findByRole('radio', { name: /Docker/ }));
    await expect(page.getByRole('button', { name: /Where work runs: Docker/ })).toBeInTheDocument();
  },
};

/** Needs setting up: the row itself goes to Settings; the next step is a few quiet words. */
export const NotReady: Story = {
  render: () => <Stateful open initial="computer" options={withSetup(notReady, () => {})} />,
};

function SettingUpDemo() {
  const [went, setWent] = useState<string>();
  return (
    <Stack gap={3} align="start">
      <Stateful options={withSetup(notReady, setWent)} />
      <output>{went ? `Opened Settings for ${went}` : ''}</output>
    </Stack>
  );
}

/** Pressing a row that needs a key opens where it's added, and the list closes. */
export const SettingUp: Story = {
  render: () => <SettingUpDemo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: /Where work runs: This computer/ }));
    await userEvent.click(await page.findByRole('radio', { name: /Daytona/ }));
    await expect(await page.findByText('Opened Settings for cloud')).toBeInTheDocument();
    await expect(
      page.getByRole('button', { name: /Where work runs: This computer/ }),
    ).toBeInTheDocument();
  },
};

/** On a phone the list is nearly the screen's width; the next step wraps under the message. */
export const NotReadyOnAPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <Stateful open initial="computer" options={withSetup(notReady, () => {})} />,
};

export const Preparing: Story = {
  render: () => (
    <Stateful
      initial="container"
      options={places.map((p) =>
        p.value === 'container'
          ? { ...p, state: 'preparing', message: 'Getting the box ready, the first time only…' }
          : p,
      )}
    />
  ),
};

/** The provider runs its own commands on this computer: said before the list. */
export const ProviderRunsItsOwn: Story = {
  render: () => (
    <Stateful
      open
      note="Codex CLI runs its own commands on this computer, in its own sandbox. Pick another provider to run work elsewhere."
    />
  ),
};

/** On a command's row, where it ran. */
export const OnARow: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <Stack direction="row" gap={2}>
      <WorkedAt kind="container" name="a container" />
      <WorkedAt kind="ssh" name="build-box" />
      <WorkedAt kind="cloud" name="the cloud" />
    </Stack>
  ),
};

/** A story whose commands all ran in a container: said once, on the row. */
export const OnAStory: Story = {
  decorators: [
    (Story) => (
      <div style={{ inlineSize: '34rem' }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <StoryRow
      headline="Installed and ran the tests"
      outcome="41 passed"
      family="run"
      status="done"
      durationMs={48_000}
      defaultOpen
      steps={[
        {
          id: 'a',
          text: 'Installed the dependencies',
          status: 'success',
          family: 'run',
          durationMs: 31_000,
          where: { kind: 'container', name: 'a container' },
        },
        {
          id: 'b',
          text: 'Ran the tests',
          outcome: '41 passed',
          status: 'success',
          family: 'verify',
          durationMs: 17_000,
          where: { kind: 'container', name: 'a container' },
        },
      ]}
    />
  ),
};
