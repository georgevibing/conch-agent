import type { Meta, StoryObj } from '@storybook/react-vite';

import { RoutineRequestCard } from './RoutineRequestCard';

const meta = {
  title: 'Patterns/Routines/RoutineRequestCard',
  component: RoutineRequestCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Another agent, or a message in a chat, asks to pause your routines (ADR 0154). It sits at the top of the Routines page; only **Pause them** changes anything.',
      },
    },
  },
  args: {
    from: 'Hermes',
    via: 'agent',
    routines: [
      { id: 'r_1', title: 'Weekly fitness recap' },
      { id: 'r_2', title: 'Monthly wealth check-in' },
    ],
    reason: 'I run these for you now.',
    onApprove: () => {},
    onDecline: () => {},
  },
} satisfies Meta<typeof RoutineRequestCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FromAnotherAgent: Story = {};

export const OneRoutine: Story = {
  args: { routines: [{ id: 'r_1', title: 'Weekly fitness recap' }], reason: undefined },
};

export const FromAChat: Story = {
  args: { via: 'chat', from: 'Moving my routines', reason: 'Hermes runs these now.' },
};

export const WithNamesThatDidNotMatch: Story = {
  args: { unmatched: ['Daily stand-up'] },
};

export const Answering: Story = { args: { busy: true } };
