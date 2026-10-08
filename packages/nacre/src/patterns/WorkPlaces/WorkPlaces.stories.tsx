import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Story as StoryRow } from '../Story/Story';
import { notReady, places } from './fixtures';
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
          'Where the chat’s work runs (ADR 0106): this computer’s sealed box, a container, a machine of yours over SSH, or a sandbox in the cloud. A calm chip beside the mode whose mark is the place. When the place changes the new mark glides up into the chip on a spring, with one glint, as if the work had just moved there (reduced motion: it simply changes). A place that isn’t ready wears a small dot — breathing while it gets ready — and its row offers the one next step. When the chat’s provider runs its own commands here whatever is chosen, the list says so first, plainly.',
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

export const NotReady: Story = {
  render: () => (
    <Stateful
      open
      initial="container"
      options={notReady.map((o) =>
        o.state === 'needs-setup'
          ? {
              ...o,
              action: (
                <Button size="sm" variant="soft">
                  {o.kind === 'cloud' ? 'Add a key' : 'Install Podman'}
                </Button>
              ),
            }
          : o,
      )}
    />
  ),
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
