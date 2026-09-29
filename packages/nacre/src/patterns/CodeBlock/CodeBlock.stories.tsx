import type { Meta, StoryObj } from '@storybook/react-vite';

import { Text } from '../../components/Text';
import { CodeBlock, InlineCode } from './CodeBlock';

const tsSample = `import { query } from '@anthropic-ai/claude-agent-sdk';

/** Stream a Claude Code session to the browser over a WebSocket. */
export async function relay(socket: WebSocket, prompt: string) {
  const session = query({ prompt, options: { cwd: process.cwd() } });

  for await (const message of session) {
    if (message.type === 'assistant') {
      socket.send(JSON.stringify({ kind: 'delta', message }));
    }
  }
  return 'done' as const;
}`;

const longSample = Array.from(
  { length: 40 },
  (_, i) =>
    `  { id: ${i + 1}, name: 'session-${String(i + 1).padStart(2, '0')}', status: '${i % 3 ? 'idle' : 'running'}' },`,
).join('\n');

const meta = {
  title: 'Patterns/Chat/CodeBlock',
  component: CodeBlock,
  args: { code: tsSample, language: 'ts' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Syntax-highlighted code. Shiki loads lazily and colours come from CSS variables mapped onto Nacre tokens, so highlighting follows the mode and accent instantly. Plain text renders first — no layout shift.',
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
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithFilename: Story = {
  args: { filename: 'apps/server/src/relay.ts', lineNumbers: true, highlight: '6-9' },
};

export const Shell: Story = {
  args: {
    language: 'bash',
    code: 'pnpm install\npnpm --filter @conch/server dev --port 4317',
  },
};

export const Collapsible: Story = {
  args: {
    language: 'ts',
    filename: 'fixtures/sessions.ts',
    code: `export const sessions = [\n${longSample}\n];`,
    maxLines: 12,
    lineNumbers: true,
  },
};

export const LongLinesWrapped: Story = {
  args: {
    language: 'json',
    defaultWrap: true,
    code: JSON.stringify(
      {
        type: 'tool_use',
        name: 'Bash',
        input: {
          command:
            'find . -name "*.tsx" -not -path "./node_modules/*" | xargs grep -l "useEffect" | head -n 20',
          description: 'Find components that use effects',
        },
      },
      null,
      2,
    ),
  },
};

export const Bare: Story = {
  args: {
    variant: 'bare',
    language: 'python',
    code: 'def greet(name: str) -> str:\n    return f"Hello, {name}!"',
  },
};

export const Inline: Story = {
  render: () => (
    <Text>
      Run <InlineCode>pnpm dev</InlineCode> and open <InlineCode>http://localhost:5173</InlineCode>{' '}
      to start chatting.
    </Text>
  ),
};
