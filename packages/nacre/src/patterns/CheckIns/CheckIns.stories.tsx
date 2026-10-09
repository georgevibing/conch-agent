import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CheckInCard, type ToldItem } from './CheckIn';
import { MorningDigest, type DigestLine } from './MorningDigest';
import { StandingOrderList, StandingOrderOffer, type StandingOrderItem } from './StandingOrders';

const POWER_NOTE =
  'A standing order can’t change what Conch asks about. It still asks first wherever your permission mode does.';
const kindOf = (text: string) =>
  /^(you may|feel free|archive|delete)/i.test(text) ? ('may' as const) : ('tell' as const);
const powerOf = (text: string) => /without asking|auto-?approve/i.test(text);

const meta = {
  title: 'Patterns/CheckIns',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Check-ins, standing orders and the morning’s note (ADR 0107). **Standing orders** are what the person said once, in their words: “Tell me” ones are what the check-in watches for, “You may” ones what they welcome. Neither is a permission, and a line says so beside any that reaches for one. The **check-in** card is calm: a pearl that glints when it told you something, one line on how it’s doing, and what it told you, each with **Why?**. The **morning’s note** shows what Conch learned and tidied overnight, each line with **Undo**, under a band of first light that rises once. It sits at the top of Settings → What Conch knows only, never in a chat.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const orders: StandingOrderItem[] = [
  {
    id: 'o1',
    text: 'Always tell me if a flight changes',
    kind: 'tell',
    state: 'on',
    meta: 'Told you twice · last yesterday',
  },
  { id: 'o2', text: 'You may archive newsletters', kind: 'may', state: 'on' },
  { id: 'o3', text: 'Tell me when Anna writes', kind: 'tell', state: 'draft' },
];

export const Orders: Story = {
  render: () => {
    const [items, setItems] = useState(orders);
    return (
      <div style={{ maxInlineSize: 560 }}>
        <StandingOrderList
          items={items}
          kindOf={kindOf}
          powerOf={powerOf}
          powerNote={POWER_NOTE}
          onAdd={(text) =>
            setItems((all) => [
              ...all,
              {
                id: String(all.length + 1),
                text,
                kind: kindOf(text),
                state: 'on',
                power: powerOf(text),
              },
            ])
          }
          onSave={(id, text) =>
            setItems((all) =>
              all.map((o) => (o.id === id ? { ...o, text, kind: kindOf(text) } : o)),
            )
          }
          onRemove={(id) => setItems((all) => all.filter((o) => o.id !== id))}
          onKeep={(id) =>
            setItems((all) => all.map((o) => (o.id === id ? { ...o, state: 'on' } : o)))
          }
        />
      </div>
    );
  },
};

/** One that reaches for a permission: Conch says plainly it can't give one. */
export const OrderThatReachesForAPower: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <StandingOrderList
        items={[
          {
            id: 'o1',
            text: 'You may send emails without asking',
            kind: 'may',
            state: 'on',
            power: true,
          },
        ]}
        powerNote={POWER_NOTE}
        onAdd={() => undefined}
        onRemove={() => undefined}
      />
    </div>
  ),
};

/** None yet: the field suggests one, a new idea now and then. */
export const NoOrdersYet: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <StandingOrderList
        items={[]}
        kindOf={kindOf}
        powerOf={powerOf}
        powerNote={POWER_NOTE}
        onAdd={() => undefined}
      />
    </div>
  ),
};

export const OfferInTheChat: Story = {
  render: () => {
    const [state, setState] = useState<'offered' | 'kept' | 'dismissed'>('offered');
    return (
      <div style={{ maxInlineSize: 560 }}>
        <StandingOrderOffer
          text="Always tell me if a flight changes"
          kind="tell"
          powerNote={POWER_NOTE}
          state={state}
          onKeep={() => setState('kept')}
          onDismiss={() => setState('dismissed')}
          onOpen={() => undefined}
        />
      </div>
    );
  },
};

export const OfferKept: Story = {
  render: () => (
    <StandingOrderOffer
      text="You may archive newsletters"
      kind="may"
      powerNote={POWER_NOTE}
      state="kept"
      onOpen={() => undefined}
    />
  ),
};

const told: ToldItem[] = [
  {
    id: 't1',
    source: 'mail',
    title: 'Lufthansa’s email “LH 452 has a new departure time”',
    note: 'Departure moved to 18:40',
    why: 'You asked: “Always tell me if a flight changes”',
    when: '12 minutes ago',
    href: 'https://mail.google.com/',
  },
  {
    id: 't2',
    source: 'calendar',
    title: 'Dentist',
    note: 'Moved to 4:30 PM',
    why: 'You asked: “Tell me if an appointment moves”',
    when: 'Yesterday at 9:10 AM',
  },
  {
    id: 't3',
    source: 'mail',
    title: 'DHL’s email “Your parcel is on its way”',
    why: 'You asked: “Tell me when my parcel is out for delivery”',
    when: 'Monday',
    quiet: true,
  },
];

export const CheckIn: Story = {
  render: () => {
    const [on, setOn] = useState(true);
    return (
      <div style={{ maxInlineSize: 560 }}>
        <CheckInCard
          state={on ? 'watching' : 'off'}
          line="Watching for 2 things · looked 12 minutes ago · free until something’s new"
          quiet="Quiet 10:00 PM – 7:00 AM"
          onToggle={setOn}
          onLookNow={() => undefined}
          told={told}
          onForget={() => undefined}
        />
      </div>
    );
  },
};

export const CheckInQuietHours: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <CheckInCard
        state="quiet"
        line="Looks again at 7:00 AM"
        quiet="Quiet 10:00 PM – 7:00 AM"
        onToggle={() => undefined}
        onLookNow={() => undefined}
        told={told.slice(0, 1)}
      />
    </div>
  ),
};

export const CheckInNeedsYou: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <CheckInCard
        state="needs-you"
        line="Last looked an hour ago"
        problem={{
          message: 'Gmail needs you to sign in again.',
          action: 'Open Apps',
          onAction: () => undefined,
        }}
        onToggle={() => undefined}
      />
    </div>
  ),
};

export const CheckInResting: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <CheckInCard
        state="resting"
        line="Tell Conch something you want to hear about, and it starts looking."
        onToggle={() => undefined}
      />
    </div>
  ),
};

/** Looking right now: the pearl breathes. */
export const CheckInLooking: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <CheckInCard
        state="watching"
        line="Looking now"
        quiet="Quiet 10:00 PM – 7:00 AM"
        onToggle={() => undefined}
        onLookNow={() => undefined}
        looking
      />
    </div>
  ),
};

const lines: DigestLine[] = [
  { id: 'd1', kind: 'learned', text: 'Prefers TypeScript for new scripts', state: 'applied' },
  {
    id: 'd2',
    kind: 'replaced',
    text: 'Lives in Lisbon',
    was: 'Lives in Berlin',
    state: 'applied',
  },
  {
    id: 'd3',
    kind: 'merged',
    text: 'Has a daughter, Mia, who starts school in September',
    state: 'applied',
  },
];

export const MorningNote: Story = {
  render: () => {
    const [items, setItems] = useState(lines);
    const [gone, setGone] = useState(false);
    if (gone) return <p>Folded away.</p>;
    return (
      <div style={{ maxInlineSize: 560 }}>
        <MorningDigest
          items={items}
          onUndo={(id) =>
            setItems((all) => all.map((i) => (i.id === id ? { ...i, state: 'undone' } : i)))
          }
          onDismiss={() => setGone(true)}
        />
      </div>
    );
  },
};

export const MorningNoteWithOneUndone: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <MorningDigest
        items={lines.map((l) => (l.id === 'd1' ? { ...l, state: 'undone' } : l))}
        onUndo={() => undefined}
        onDismiss={() => undefined}
      />
    </div>
  ),
};

export const MorningNoteLater: Story = {
  render: () => (
    <div style={{ maxInlineSize: 560 }}>
      <MorningDigest
        title="Since you last looked"
        items={[...lines, ...lines.map((l) => ({ ...l, id: `${l.id}b` }))]}
        onUndo={() => undefined}
        onDismiss={() => undefined}
      />
    </div>
  ),
};
