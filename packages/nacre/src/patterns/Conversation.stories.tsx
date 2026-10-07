import type { Meta, StoryObj } from '@storybook/react-vite';
import { Paperclip, RotateCcw, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { IconButton } from '../components/IconButton';
import { CodeBlock } from './CodeBlock';
import { Composer } from './Composer';
import { CopyButton } from './CopyButton';
import { Diff } from './Diff';
import { DemoToolbar } from './ModelPicker/fixtures';
import { sampleCode, sampleDiff, sampleReply, sampleTestOutput } from './fixtures';
import { Message, MessageList } from './Message';
import { Prose } from './Prose';
import { StreamingText } from './StreamingText';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ToolCall, type ToolCallStatus } from './ToolCall';

const meta = {
  title: 'Patterns/Chat/Conversation',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Every chat pattern composed into a realistic coding session: replies under their speaker line, tool calls with a file diff, code, a table, the thinking state and the composer, all on one column edge.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const t = (m: number) => new Date(2026, 8, 29, 10, m);

const toolbar = (
  <>
    <IconButton size="sm" label="Attach files">
      <Paperclip />
    </IconButton>
    <DemoToolbar />
  </>
);

function Shell({
  children,
  composer,
  loading,
}: {
  children: ReactNode;
  composer: ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        blockSize: '100vh',
        maxInlineSize: 820,
        marginInline: 'auto',
      }}
    >
      <MessageList loading={loading}>{children}</MessageList>
      <div style={{ padding: '0 16px 20px' }}>{composer}</div>
    </div>
  );
}

/** How a part of a reply places itself (the web's `.part`): a step under what's above, at the column's edge. */
const part: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  marginBlockStart: 'calc(var(--nc-chat-step) - var(--nc-chat-flow-gap))',
  marginInlineStart: 'var(--nc-chat-indent)',
};

const tools: CSSProperties = { ...part, gap: 6 };

function History() {
  return (
    <>
      <Message from="system" timestamp={t(40)}>
        New session · ~/code/conch
      </Message>
      <Message
        from="user"
        timestamp={t(41)}
        actions={<CopyButton value="…" label="Copy message" />}
      >
        The session relay drops frames when the client sends quickly. Can you make it validate
        incoming frames and queue them properly?
      </Message>
      <Message
        from="assistant"
        timestamp={t(41)}
        meta="Opus 4.5"
        actions={
          <>
            <CopyButton value={sampleReply} label="Copy reply" />
            <IconButton size="sm" label="Retry">
              <RotateCcw />
            </IconButton>
            <IconButton size="sm" label="Good response">
              <ThumbsUp />
            </IconButton>
          </>
        }
        attached={
          <>
            <div style={tools}>
              <ToolCall
                name="Read"
                summary="apps/server/src/session.ts"
                duration={42}
                output={sampleCode}
                outputLanguage="ts"
              />
              <ToolCall
                name="Grep"
                summary={'"buffer" in apps/server'}
                duration={118}
                output={'apps/server/src/session.ts:13\napps/server/src/session.ts:18'}
              />
              <ToolCall name="Edit" summary="apps/server/src/session.ts" duration={310}>
                <Diff diff={sampleDiff} header={false} />
              </ToolCall>
              <ToolCall
                name="Bash"
                summary="pnpm --filter @conch/server test"
                duration={2140}
                output={sampleTestOutput}
              />
            </div>
            <div style={part}>
              <Prose>
                <p>
                  The bug was that frames were concatenated into a single string buffer, so two
                  messages arriving in the same tick were merged. Frames are now parsed individually
                  and validated with the shared schema:
                </p>
                <CodeBlock code={sampleCode} language="ts" filename="apps/server/src/protocol.ts" />
                <p>What changed, at a glance:</p>
                <table>
                  <thead>
                    <tr>
                      <th>Before</th>
                      <th>After</th>
                      <th>Why it matters</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>One string buffer</td>
                      <td>A typed queue</td>
                      <td>Two frames in one tick stay two frames</td>
                    </tr>
                    <tr>
                      <td>Parsed when read</td>
                      <td>Validated on arrival</td>
                      <td>A bad frame fails fast, with its reason</td>
                    </tr>
                    <tr>
                      <td>Close ignored</td>
                      <td>Close ends the iterator</td>
                      <td>No reader waits forever</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  All <strong>18 tests</strong> pass. Want me to add a stress test that fires 1,000
                  frames in a burst?
                </p>
              </Prose>
            </div>
          </>
        }
      >
        <Prose>
          <p>Let me look at how the relay handles incoming messages today, then fix the race.</p>
        </Prose>
      </Message>
      <Message from="user" timestamp={t(44)}>
        Yes please, and run it.
      </Message>
    </>
  );
}

export const Session: Story = {
  render: function Render() {
    return (
      <Shell composer={<Composer toolbar={toolbar} placeholder="Reply to Conch…" />}>
        <History />
        <Message from="assistant" timestamp={t(44)} status="complete">
          <Prose>
            <p>Done — the burst test passes in 94 ms with no dropped frames.</p>
          </Prose>
        </Message>
      </Shell>
    );
  },
};

/**
 * Opening a conversation that isn't here yet: its outline rests where the newest
 * messages will be (only once the wait could be noticed), then the whole
 * conversation fades in, already at its newest message — nothing piles in.
 */
export const Opening: Story = {
  render: function Render() {
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      if (!loading) return;
      const timer = setTimeout(() => setLoading(false), 1600);
      return () => clearTimeout(timer);
    }, [loading]);
    return (
      <Shell
        loading={loading}
        composer={
          <div style={{ display: 'grid', gap: 8 }}>
            <Composer toolbar={toolbar} placeholder="Reply to Conch…" />
            <button type="button" onClick={() => setLoading(true)}>
              Open it again
            </button>
          </div>
        }
      >
        <History />
      </Shell>
    );
  },
};

const liveReply =
  "I've added `session.stress.test.ts`, which opens a real WebSocket and fires 1,000 frames in one burst. Every frame arrives in order and the queue never exceeds its high-water mark.";

export const Working: Story = {
  render: function Render() {
    const [phase, setPhase] = useState<'thinking' | 'tool' | 'streaming' | 'done'>('thinking');
    const [toolStatus, setToolStatus] = useState<ToolCallStatus>('running');
    const [length, setLength] = useState(0);
    const [startedAt] = useState(() => Date.now());
    const stop = useRef(false);

    useEffect(() => {
      const timers = [
        setTimeout(() => setPhase('tool'), 1800),
        setTimeout(() => setToolStatus('success'), 3800),
        setTimeout(() => setPhase('streaming'), 4200),
      ];
      return () => timers.forEach(clearTimeout);
    }, []);

    useEffect(() => {
      if (phase !== 'streaming') return;
      const id = setInterval(() => {
        setLength((l) => {
          const next = Math.min(liveReply.length, l + 2 + Math.floor(Math.random() * 5));
          if (next >= liveReply.length || stop.current) {
            clearInterval(id);
            setPhase('done');
          }
          return next;
        });
      }, 40);
      return () => clearInterval(id);
    }, [phase]);

    const running = phase !== 'done';
    return (
      <Shell
        composer={
          <Composer
            toolbar={toolbar}
            running={running}
            onStop={() => {
              stop.current = true;
              setPhase('done');
            }}
            placeholder={running ? 'Conch is working…' : 'Reply to Conch…'}
          />
        }
      >
        <History />
        <Message from="assistant" timestamp={t(44)} status={running ? 'streaming' : 'complete'}>
          <div style={{ display: 'grid', gap: 12 }}>
            {phase === 'thinking' && <ThinkingIndicator startedAt={startedAt} orb={false} />}
            {phase !== 'thinking' && (
              <ToolCall
                name="Bash"
                summary="pnpm --filter @conch/server test session.stress"
                status={toolStatus}
                duration={1960}
                output={
                  toolStatus === 'success'
                    ? ' ✓ src/session.stress.test.ts (1 test) 94ms'
                    : undefined
                }
              />
            )}
            {(phase === 'streaming' || phase === 'done') && (
              <StreamingText
                as="p"
                text={liveReply.slice(0, length)}
                streaming={phase === 'streaming'}
              />
            )}
          </div>
        </Message>
      </Shell>
    );
  },
};
