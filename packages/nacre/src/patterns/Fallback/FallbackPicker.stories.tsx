import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import {
  FALLBACK_AUTO,
  FALLBACK_WAIT,
  FallbackPicker,
  type FallbackOption,
  type FallbackPickerProps,
} from './FallbackPicker';
import { fallbackNow, fallbackOptions, fallbackTwoAccounts } from './fixtures';

/** The picker as Settings uses it: it keeps its own choice, order and switches. */
function Live({
  initial = FALLBACK_AUTO,
  options: start = fallbackOptions,
  local = 'Ollama',
  ...rest
}: Partial<Omit<FallbackPickerProps, 'local' | 'options'>> & {
  initial?: string;
  options?: FallbackOption[];
  local?: string | null;
}) {
  const [value, setValue] = useState(initial);
  const [options, setOptions] = useState(start);
  const [offline, setOffline] = useState(true);
  const [back, setBack] = useState(true);
  return (
    <Stack gap={2}>
      <Text id="at-limit" size="sm" weight="medium">
        At a usage limit
      </Text>
      <FallbackPicker
        aria-labelledby="at-limit"
        from="Claude Code"
        fromResetsAt={fallbackNow + 3 * 3_600_000}
        now={fallbackNow}
        value={value}
        onValueChange={setValue}
        options={options}
        onReorder={(ids) => setOptions(ids.flatMap((id) => options.filter((o) => o.id === id)))}
        local={{
          ...(local && { name: local }),
          checked: offline,
          onCheckedChange: setOffline,
        }}
        back={{ checked: back, onCheckedChange: setBack }}
        {...rest}
      />
    </Stack>
  );
}

const meta = {
  title: 'Patterns/Settings/FallbackPicker',
  component: FallbackPicker,
  parameters: {
    docs: {
      description: {
        component:
          'Who carries on when a provider reaches its usage limit (ADR 0126). One radio list, best first: Automatic — the next plan or key with room, in an order you can change — then Wait until it resets, then each account by name. Each says whether it has room and until when, what it costs (included in your plan, or about what a reply costs) and the model it answers with. Two ways into one account (Codex and Codex CLI) are one choice; two accounts with the same name say whose they are. The model on this computer is the last step, and coming back once the limit resets is a switch of its own.',
      },
    },
  },
  decorators: [(Story) => <div style={{ maxInlineSize: '40rem' }}>{Story()}</div>],
  args: {
    from: 'Claude Code',
    value: FALLBACK_AUTO,
    options: fallbackOptions,
    onValueChange: () => {},
    now: fallbackNow,
  },
} satisfies Meta<typeof FallbackPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: ({ value, options, from }) => <Live from={from} initial={value} options={[...options]} />,
};

/** The default: Automatic, with the order it follows and the two switches under it. */
export const Automatic: Story = {
  render: () => <Live />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Move OpenRouter up' }));
    const steps = within(canvas.getByRole('list', { name: 'In this order' })).getAllByRole(
      'listitem',
    );
    await expect(steps[0]).toHaveTextContent('OpenRouter');
  },
};

export const WaitUntilItResets: Story = { render: () => <Live initial={FALLBACK_WAIT} /> };

/** One you picked: its facts are the description, and the model here is still the last resort. */
export const OnePick: Story = { render: () => <Live initial="codex-agent" /> };

/** Two ChatGPT accounts, named; one at its limit and a key past the month's budget, skipped. */
export const AccountsAndSkipped: Story = {
  render: () => <Live options={fallbackTwoAccounts} />,
};

/** Nothing else connected yet, and no model on this computer. */
export const NothingElse: Story = { render: () => <Live options={[]} local={null} /> };
