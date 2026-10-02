import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';

import { Button } from '../Button';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { VirtualList, type VirtualListHandle } from './VirtualList';

const names = Array.from({ length: 5000 }, (_, i) => `Row ${i + 1}`);
// Rows are things to press, as in a real list: that is also what lets the keyboard scroll it.
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  inlineSize: '100%',
  blockSize: '100%',
  paddingInline: 'var(--nc-space-3)',
  border: 0,
  font: 'inherit',
  color: 'inherit',
  textAlign: 'start',
  background: 'transparent',
  boxShadow: 'inset 0 -1px 0 var(--nc-border-subtle)',
} as const;

const meta = {
  title: 'Components/Display/VirtualList',
  component: VirtualList,
  args: {
    items: names,
    rowHeight: 2.5,
    getKey: (name) => name as string,
    children: (name) => (
      <button type="button" style={rowStyle}>
        {name as string}
      </button>
    ),
    role: 'list',
    'aria-label': 'Rows',
    rowProps: (_, i) => ({
      role: 'listitem',
      'aria-setsize': names.length,
      'aria-posinset': i + 1,
    }),
    style: { blockSize: 360, maxInlineSize: 360 },
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A long list that only draws the rows in view, so a thousand rows cost what twenty do: a search above it answers every key at once, and selecting a row never waits on the list. Rows are placed in rem, exactly where CSS would have put them at any text size, and the scrollbar still speaks for all of them. The row that has the keyboard stays drawn while it’s scrolled away, so focus is never lost to scrolling. Give rows a fixed height (one, or one per kind of row); `sticky` rows are headings that stay at the top while their group passes. Rows hold something to press, which is also what lets the keyboard reach and scroll the list.',
      },
    },
  },
} satisfies Meta<typeof VirtualList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five thousand rows; scroll, and look at how few are in the page. */
export const Playground: Story = {};

interface GroupRow {
  id: string;
  heading?: true;
}
const grouped: GroupRow[] = Array.from({ length: 26 }, (_, g) => {
  const letter = String.fromCharCode(65 + g);
  return [
    { id: letter, heading: true as const },
    ...Array.from({ length: 12 }, (__, i) => ({ id: `${letter}${letter.toLowerCase()} ${i + 1}` })),
  ];
}).flat();

/** Headings are shorter than rows, and each stays at the top while its group passes under it. */
export const Groups: Story = {
  render: () => (
    <VirtualList
      role="list"
      aria-label="Grouped rows"
      style={{ blockSize: 360, maxInlineSize: 360 }}
      items={grouped}
      rowHeight={(row) => (row.heading ? 1.75 : 2.5)}
      getKey={(row) => row.id}
      sticky={(row) => Boolean(row.heading)}
      rowProps={(row) => ({ role: row.heading ? 'presentation' : 'listitem' })}
    >
      {(row) =>
        row.heading ? (
          <div
            aria-hidden
            style={{
              ...rowStyle,
              boxShadow: 'none',
              background: 'var(--nc-canvas)',
              fontSize: 'var(--nc-text-xs)',
              fontWeight: 'var(--nc-weight-semibold)',
              color: 'var(--nc-text-subtle)',
            }}
          >
            {row.id}
          </div>
        ) : (
          <button type="button" style={rowStyle}>
            {row.id}
          </button>
        )
      }
    </VirtualList>
  ),
};

/** `scrollToIndex` brings a row into view, scrolling no further than it must. */
export const ScrollToARow: Story = {
  render: function Render() {
    const handle = useRef<VirtualListHandle>(null);
    const [at, setAt] = useState(0);
    const go = (index: number) => {
      setAt(index);
      handle.current?.scrollToIndex(index);
    };
    return (
      <Stack gap={3} style={{ maxInlineSize: 360 }}>
        <Stack direction="row" gap={2} align="center">
          <Button size="sm" variant="surface" onClick={() => go(Math.max(0, at - 250))}>
            Back 250
          </Button>
          <Button size="sm" variant="surface" onClick={() => go(Math.min(4999, at + 250))}>
            On 250
          </Button>
          <Text size="sm" tone="subtle">
            Row {at + 1}
          </Text>
        </Stack>
        <VirtualList
          role="list"
          aria-label="Rows"
          handle={handle}
          style={{ blockSize: 320 }}
          items={names}
          rowHeight={2.5}
          getKey={(name) => name}
          rowProps={() => ({ role: 'listitem' })}
        >
          {(name, i) => (
            <button type="button" style={{ ...rowStyle, fontWeight: i === at ? 600 : undefined }}>
              {name}
            </button>
          )}
        </VirtualList>
      </Stack>
    );
  },
};
