import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { Text } from '../../components/Text';
import { AllowedList, type AllowedRow } from './AllowedList';

const KINDS: AllowedRow[] = [
  {
    id: 'risk:install:moderate',
    words: 'install a package it doesn’t know well',
    forget: 'Ask again before it would install a package it doesn’t know well',
  },
  {
    id: 'risk:egress:push code to a remote',
    words: 'push code to a remote',
    forget: 'Ask again before it would push code to a remote',
  },
];

const COMMANDS: AllowedRow[] = [
  {
    id: 'r1',
    words: 'git push origin feature/*',
    forget: 'Ask again before git push origin feature/*',
    where: 'shop',
  },
  {
    id: 'r2',
    words: 'terraform apply -target=module.dev',
    forget: 'Ask again before terraform apply -target=module.dev',
    where: 'infra',
  },
  {
    id: 'r3',
    words:
      'aws s3 sync dist s3://acme-scratch/previews --delete --exclude .DS_Store --cache-control max-age=60',
    forget: 'Ask again before aws s3 sync dist s3://acme-scratch/previews',
    where: 'a-very-long-work-folder-name-for-the-marketing-site',
  },
];

const meta = {
  title: 'Patterns/Safety/AllowedList',
  component: AllowedList,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What Auto never asks about again, in any chat: kinds of step lifted with “Always allow, in every chat”, and single commands lifted with “Always allow `…`” (ADR 0149), each with the folder it holds in. One quiet row each; the × makes Auto ask again, so it needs no second look. Settings → Security → Safety.',
      },
    },
  },
  args: { rows: KINDS, onForget: () => undefined },
  decorators: [(Story) => <div style={{ maxInlineSize: 560 }}>{Story()}</div>],
  render: function Render(args) {
    const [rows, setRows] = useState(args.rows);
    return (
      <AllowedList
        {...args}
        rows={rows}
        onForget={(id) => setRows(rows.filter((r) => r.id !== id))}
      />
    );
  },
} satisfies Meta<typeof AllowedList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Kinds of step: in words. */
export const Kinds: Story = { args: { 'aria-label': 'Kinds of step Auto never asks about' } };

/** Commands: as code, with the folder; a long one ends in an ellipsis. */
export const Commands: Story = {
  args: { rows: COMMANDS, code: true, 'aria-label': 'Commands Auto never asks about' },
};

/** Both, as Safety shows them. */
export const InSafety: Story = {
  render: () => (
    <Stack gap={4}>
      <Stack gap={2}>
        <Text size="sm" tone="subtle">
          Auto never asks again, in any chat, before it would:
        </Text>
        <AllowedList rows={KINDS} onForget={() => undefined} />
      </Stack>
      <Stack gap={2}>
        <Text size="sm" tone="subtle">
          Or before it runs:
        </Text>
        <AllowedList rows={COMMANDS.slice(0, 2)} code onForget={() => undefined} />
      </Stack>
    </Stack>
  ),
};

/** Nothing lifted: nothing drawn. */
export const Empty: Story = { args: { rows: [] } };
