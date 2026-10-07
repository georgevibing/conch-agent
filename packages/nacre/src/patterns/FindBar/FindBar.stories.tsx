import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';

import { CopyButton } from '../CopyButton';
import { MessageList } from '../Message/MessageList';
import { Message } from '../Message/Message';
import { FindBar, FindRail } from './FindBar';
import { useFind } from './useFind';

const meta = {
  title: 'Patterns/Chat/FindBar',
  component: FindBar,
  args: {
    query: 'parser',
    count: 17,
    current: 2,
    onQueryChange: () => {},
    onNext: () => {},
    onPrev: () => {},
    onClose: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          'Find in this conversation. A small floating pill: every match lights up as you type (painted with the CSS Custom Highlight API, so the transcript DOM is never touched), ↵ / ⇧↵ walk through them, and a rail of ticks along the scrollbar shows where matches sit in the whole conversation. Pair with `useFind(rootRef, { query })`.',
      },
    },
  },
} satisfies Meta<typeof FindBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const NoMatches: Story = { args: { query: 'zebracorn', count: 0, current: -1 } };

export const Empty: Story = { args: { query: '', count: 0, current: -1 } };

const replies = Array.from({ length: 24 }, (_, i) => ({
  user: `Question ${i + 1}: what does the parser do with case ${i + 1}?`,
  reply:
    i % 4 === 0
      ? `For case ${i + 1} the parser treats the token as an identifier. Watch the tokenizer quirk with unicode escapes.`
      : `Case ${i + 1} is handled by the lexer before it reaches the parser, so nothing special is needed.`,
}));

function Live() {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('tokenizer');
  const find = useFind(root, { query });
  const perTick = find.positions.length ? Math.ceil(find.count / find.positions.length) : 1;
  return (
    <div style={{ blockSize: 560, display: 'flex' }}>
      <MessageList
        overlay={
          <>
            <div style={{ position: 'absolute', insetBlockStart: 12, insetInlineEnd: 20 }}>
              <FindBar
                query={query}
                onQueryChange={setQuery}
                count={find.count}
                current={find.current}
                onNext={find.next}
                onPrev={find.prev}
                onClose={() => setQuery('')}
              />
            </div>
            <FindRail positions={find.positions} current={Math.floor(find.current / perTick)} />
          </>
        }
      >
        <div ref={root} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {replies.map((r, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <Message from="user">{r.user}</Message>
              <Message from="assistant" actions={<CopyButton value={r.reply} label="Copy reply" />}>
                {r.reply}
              </Message>
            </div>
          ))}
        </div>
      </MessageList>
    </div>
  );
}

/** A real transcript: type to find, ↵ to step, ticks on the right show where matches are. */
export const InATranscript: Story = { render: () => <Live /> };
