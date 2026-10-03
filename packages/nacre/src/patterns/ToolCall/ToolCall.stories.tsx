import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Diff } from '../Diff';
import { sampleDiff, sampleTestOutput } from '../fixtures';
import { FileList } from '../ToolViews';
import { files } from '../ToolViews/fixtures';
import { ToolCall, type ToolCallStatus } from './ToolCall';

const meta = {
  title: 'Patterns/Chat/ToolCall',
  component: ToolCall,
  args: {
    name: 'Bash',
    summary: 'pnpm --filter @conch/server test',
    status: 'success',
    duration: 2140,
    input: JSON.stringify(
      { command: 'pnpm --filter @conch/server test', timeout: 120000 },
      null,
      2,
    ),
    output: sampleTestOutput,
  },
  argTypes: {
    status: {
      control: 'inline-radio',
      options: ['pending', 'running', 'success', 'error', 'cancelled'],
    },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A tool invocation by the agent. Collapsed it is a calm, scannable row — status, tool, a monospace summary and duration. Expand to inspect input and output. Status changes settle in with a spring; a band of light sweeps the summary while running.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 720, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToolCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Expanded: Story = { args: { defaultOpen: true } };

export const States: Story = {
  render: () => (
    <Stack gap={2}>
      <ToolCall name="Read" summary="apps/server/src/session.ts" status="pending" />
      <ToolCall name="Grep" summary={'"ClientMessage" in packages/'} status="running" />
      <ToolCall
        name="Bash"
        summary="pnpm test"
        status="success"
        duration={2140}
        output={sampleTestOutput}
      />
      <ToolCall
        name="Bash"
        summary="pnpm typecheck"
        status="error"
        duration={4810}
        output={
          "src/session.ts(14,3): error TS2322: Type 'string' is not assignable to type 'ClientMessage[]'."
        }
      />
      <ToolCall name="WebFetch" summary="https://docs.anthropic.com" status="cancelled" />
      <ToolCall
        name="mcp__github__create_pull_request"
        summary="feat: typed session queue"
        status="success"
        duration={890}
      />
    </Stack>
  ),
};

/** What it found, drawn under the row and open; the raw output stays behind the chevron. */
export const WithAView: Story = {
  args: {
    name: 'mcp__conch__google_drive_search',
    summary: 'launch',
    input: undefined,
    output: '{"files":[…]}',
    duration: 640,
    view: <FileList files={files(Date.now()).slice(0, 3)} />,
  },
};

export const FileEdit: Story = {
  args: {
    name: 'Edit',
    summary: 'apps/server/src/session.ts',
    duration: 320,
    input: undefined,
    output: undefined,
    defaultOpen: true,
    children: <Diff diff={sampleDiff} header={false} />,
  },
};

export const LiveStatus: Story = {
  render: function Render() {
    const [status, setStatus] = useState<ToolCallStatus>('pending');
    const [run, setRun] = useState(0);
    useEffect(() => {
      setStatus('pending');
      const a = setTimeout(() => setStatus('running'), 600);
      const b = setTimeout(() => setStatus('success'), 2600);
      return () => {
        clearTimeout(a);
        clearTimeout(b);
      };
    }, [run]);
    return (
      <Stack gap={3} align="start">
        <div style={{ inlineSize: '100%' }}>
          <ToolCall
            name="Bash"
            summary="pnpm --filter @conch/server test"
            status={status}
            duration={2000}
            output={status === 'success' ? sampleTestOutput : undefined}
          />
        </div>
        <Button size="sm" variant="surface" onClick={() => setRun((r) => r + 1)}>
          Replay
        </Button>
      </Stack>
    );
  },
};
