import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderInput, PersonStanding, Sunrise } from 'lucide-react';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { RoutineCard, type RoutineCardStatus } from './RoutineCard';

const hour = 3_600_000;
const now = Date.now();

const meta = {
  title: 'Patterns/Routines/RoutineCard',
  component: RoutineCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A routine at a glance. `list` cards live on the Routines page: tap anywhere to open, flip the switch to pause. `proposal` cards appear inline when Claude drafts a routine in a chat — nothing runs until you tap **Turn on**.',
      },
    },
  },
  args: {
    title: 'Morning briefing',
    summary: 'A short summary of today’s calendar, weather and top news.',
    scheduleText: 'Weekdays at 7:30 AM',
    status: 'active',
    nextRunAt: now + 16 * hour,
    icon: <Sunrise />,
    onOpen: () => {},
    onToggle: () => {},
  },
} satisfies Meta<typeof RoutineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    cost: { text: 'About $14 a month', billing: 'metered' },
    lastRun: {
      status: 'succeeded',
      at: now - 2 * hour,
      outcome: 'Sent your briefing — 3 meetings, light rain after 4 PM.',
    },
  },
};

export const List: Story = {
  render: () => {
    const [states, setStates] = useState<Record<string, boolean>>({
      a: true,
      b: true,
      c: false,
      d: true,
    });
    const toggle = (id: string) => (on: boolean) => setStates((s) => ({ ...s, [id]: on }));
    return (
      <Stack gap={3} style={{ maxInlineSize: '40rem' }}>
        <RoutineCard
          title="Morning briefing"
          summary="A short summary of today’s calendar, weather and top news."
          scheduleText="Weekdays at 7:30 AM"
          status={states.a ? 'active' : 'paused'}
          nextRunAt={now + 16 * hour}
          icon={<Sunrise />}
          cost={{ text: 'About $14 a month', billing: 'metered' }}
          lastRun={{
            status: 'succeeded',
            at: now - 2 * hour,
            outcome: 'Sent your briefing — 3 meetings, light rain after 4 PM.',
          }}
          onOpen={() => {}}
          onToggle={toggle('a')}
        />
        <RoutineCard
          title="Tidy Downloads"
          summary="Sorts new files in Downloads into folders by type."
          scheduleText="Every Sunday at 6:00 PM"
          status={states.b ? 'active' : 'paused'}
          nextRunAt={now + 3 * 24 * hour}
          icon={<FolderInput />}
          cost={{ text: 'About 3% of your Claude Max limit a run', billing: 'plan' }}
          lastRun={{
            status: 'needs-you',
            at: now - 20 * 60_000,
            outcome: 'Wants to move 14 files into Documents/Invoices.',
          }}
          onOpen={() => {}}
          onToggle={toggle('b')}
        />
        <RoutineCard
          title="Stretch reminder"
          summary="A gentle nudge to stand up and stretch."
          scheduleText="Every 2 hours"
          status={states.c ? 'active' : 'paused'}
          nextRunAt={now + 90 * 60_000}
          icon={<PersonStanding />}
          cost={{ text: 'Free on this computer', billing: 'free' }}
          lastRun={{
            status: 'nothing-to-do',
            at: now - 26 * hour,
            outcome: 'Skipped the reminder — your calendar showed a meeting.',
          }}
          onOpen={() => {}}
          onToggle={toggle('c')}
        />
        <RoutineCard
          title="Weekly report"
          summary="Drafts a weekly summary of your project’s changes."
          scheduleText="Fridays at 4:00 PM"
          status={states.d ? 'active' : 'paused'}
          nextRunAt={now + 5 * 24 * hour}
          lastRun={{
            status: 'failed',
            at: now - 3 * 24 * hour,
            outcome: 'Couldn’t reach Claude — your sign-in had expired.',
          }}
          onOpen={() => {}}
          onToggle={toggle('d')}
        />
      </Stack>
    );
  },
};

export const Proposal: Story = {
  name: 'Proposal (in a chat)',
  render: () => {
    const [status, setStatus] = useState<RoutineCardStatus>('draft');
    const [busy, setBusy] = useState(false);
    return (
      <Stack gap={3} style={{ maxInlineSize: '36rem' }}>
        <RoutineCard
          variant="proposal"
          title="Morning briefing"
          summary="A short summary of today’s calendar, weather and top news."
          scheduleText="Weekdays at 7:30 AM"
          status={status}
          nextRunAt={now + 16 * hour}
          icon={<Sunrise />}
          cost={{ text: 'Roughly $18 a month', billing: 'metered' }}
          busy={busy}
          onActivate={() => {
            setBusy(true);
            setTimeout(() => {
              setBusy(false);
              setStatus('active');
            }, 700);
          }}
          onTryNow={() => {}}
          onEdit={() => {}}
          onDismiss={() => setStatus('deleted')}
          onOpen={() => {}}
        />
        {status !== 'draft' && (
          <button type="button" onClick={() => setStatus('draft')} style={{ alignSelf: 'start' }}>
            Reset story
          </button>
        )}
      </Stack>
    );
  },
};

export const ProposalStates: Story = {
  render: () => (
    <Stack gap={3} style={{ maxInlineSize: '36rem' }}>
      {(['draft', 'active', 'paused', 'deleted'] as const).map((status) => (
        <RoutineCard
          key={status}
          variant="proposal"
          title="Tidy Downloads"
          summary="Sorts new files in Downloads into folders by type."
          scheduleText="Every Sunday at 6:00 PM"
          status={status}
          nextRunAt={now + 3 * 24 * hour}
          icon={<FolderInput />}
          onActivate={() => {}}
          onTryNow={() => {}}
          onEdit={() => {}}
          onDismiss={() => {}}
          onOpen={() => {}}
        />
      ))}
    </Stack>
  ),
};
