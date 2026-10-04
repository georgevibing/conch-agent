import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import { PlanRoom, type PlanRoomPlan } from './PlanRoom';
import { RoutineSpendingGauge, RoutinesPaused } from './RoutineSpending';

const nextMonth = new Date(2026, 10, 1).getTime();

const meta = {
  title: 'Patterns/Routines/RoutineSpending',
  component: RoutineSpendingGauge,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What routines may still spend this month (ADR 0057), in the usage gauge’s battery words: what’s left, and when it starts again. Only pay-as-you-go money counts; a plan or a model on this computer is free here. At the limit, `RoutinesPaused` says so once, with the two choices that matter.',
      },
    },
  },
  args: {
    monthUsd: 3.2,
    limitUsd: 20,
    projectedUsd: 14.1,
    resetsAt: nextMonth,
  },
  render: (args) => (
    <div style={{ maxInlineSize: '32rem' }}>
      <RoutineSpendingGauge {...args} />
    </div>
  ),
} satisfies Meta<typeof RoutineSpendingGauge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: () => (
    <Stack gap={6} style={{ maxInlineSize: '32rem' }}>
      <RoutineSpendingGauge monthUsd={3.2} limitUsd={20} projectedUsd={14.1} resetsAt={nextMonth} />
      <RoutineSpendingGauge monthUsd={16.4} limitUsd={20} projectedUsd={18} resetsAt={nextMonth} />
      <RoutineSpendingGauge monthUsd={9.6} limitUsd={20} projectedUsd={37} resetsAt={nextMonth} />
      <RoutineSpendingGauge monthUsd={41.25} limitUsd={null} resetsAt={nextMonth} />
    </Stack>
  ),
};

export const Paused: Story = {
  render: () => (
    <div style={{ maxInlineSize: '40rem' }}>
      <RoutinesPaused
        monthUsd={20.4}
        until={nextMonth}
        onRaise={() => {}}
        onKeepPaused={() => {}}
      />
    </div>
  ),
};

const inFiveDays = new Date(2026, 9, 9, 18, 0).getTime();
const today = new Date(2026, 9, 4, 22, 40).getTime();

/**
 * Room for your own chats: how full a plan may get before routines on it
 * wait, or never. The line underneath follows the choice as it changes.
 */
export const RoomForYourChats: Story = {
  render: () => {
    function Demo({ plans }: { plans: PlanRoomPlan[] }) {
      const [percent, setPercent] = useState<number | null>(80);
      return <PlanRoom percent={percent} onChange={setPercent} plans={plans} now={today} />;
    }
    return (
      <Stack gap={6} style={{ maxInlineSize: '40rem' }}>
        <Demo
          plans={[{ source: 'Claude Max', usedPercent: 81, resetsAt: inFiveDays, waiting: 1 }]}
        />
        <Demo plans={[{ source: 'ChatGPT Plus', usedPercent: 38, waiting: 0 }]} />
        <Demo plans={[]} />
      </Stack>
    );
  },
};
