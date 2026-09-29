import type { Meta, StoryObj } from '@storybook/react-vite';

import { CodeBlock } from '../CodeBlock';
import { sampleCode } from '../fixtures';
import { Prose } from './Prose';

const meta = {
  title: 'Patterns/Chat/Prose',
  component: Prose,
  args: { size: 'md', measure: true },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] } },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Typography for rendered Markdown from the agent. Generous leading, a reading measure, tuned vertical rhythm, and small signature details — blockquotes wear a pearl rule instead of a flat bar.',
      },
    },
  },
} satisfies Meta<typeof Prose>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Prose {...args}>
      <h2>Refactoring the session relay</h2>
      <p>
        The relay now owns a <strong>typed queue</strong> of client messages instead of a raw string
        buffer. Each frame is validated with the shared <code>ClientMessage</code> schema from{' '}
        <a href="#protocol">@conch/protocol</a> before it reaches Claude Code.
      </p>
      <h3>What changed</h3>
      <ul>
        <li>
          <code>Session.messages()</code> is an async iterator that ends when the socket closes.
        </li>
        <li>
          Malformed frames raise a <code>ProtocolError</code> and are reported to the client.
        </li>
        <li>
          Backpressure is handled by pausing the socket when the queue exceeds{' '}
          <mark>64 messages</mark>.
        </li>
      </ul>
      <CodeBlock code={sampleCode} language="ts" filename="apps/server/src/protocol.ts" />
      <blockquote>
        <p>Prefer validating at the boundary. Everything past the socket can trust its types.</p>
      </blockquote>
      <ol>
        <li>Run the server tests</li>
        <li>
          Restart the dev server with <kbd>⌃</kbd> <kbd>C</kbd> then <code>pnpm dev</code>
        </li>
        <li>Reconnect the browser tab</li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>Suite</th>
            <th>Tests</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>session.test.ts</td>
            <td>6</td>
            <td>41 ms</td>
          </tr>
          <tr>
            <td>protocol.test.ts</td>
            <td>12</td>
            <td>18 ms</td>
          </tr>
        </tbody>
      </table>
      <hr />
      <p>
        <small>Tip: ask me to add an integration test that drives a real WebSocket.</small>
      </p>
    </Prose>
  ),
};

export const Small: Story = { ...Playground, args: { size: 'sm', measure: true } };
