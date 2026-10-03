import type { Meta, StoryObj } from '@storybook/react-vite';

import { AgendaView } from './AgendaView';
import { agenda, AppTool, at, day, InChat, ViewSurface } from './fixtures';

const now = Date.now();

const meta = {
  title: 'Patterns/Chat/AgendaView',
  component: AgendaView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A calendar window a tool read, drawn as days under its tool row (ADR 0055): Today, Tomorrow, then the weekday. All-day events lie in a band at the top of their day; timed ones have a time column and a slim rail in their calendar’s colour, a camera for a video call and the place in grey. A day with nothing on says Free, and today shows where now is. Six rows, then **Show all**. Everything is plain text; a row opens the event in a new tab.',
      },
    },
  },
  args: {
    events: agenda(now),
    from: at(now, 0, 0),
    to: at(now, 3, 0),
    now,
  },
  decorators: [
    (Story) => (
      <ViewSurface>
        <Story />
      </ViewSurface>
    ),
  ],
} satisfies Meta<typeof AgendaView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** A day with a few things on, and now between them. */
export const Today: Story = {
  args: {
    events: agenda(now).filter((e) => !e.start.startsWith(day(now, 1))),
    to: at(now, 1, 0),
  },
};

/** Nothing on: the days still show, as free. */
export const FreeDays: Story = { args: { events: [] } };

/** Nothing at all, and no window to show. */
export const Empty: Story = { args: { events: [], from: undefined, to: undefined } };

/** A busy week folds after six rows. */
export const Busy: Story = {
  args: {
    events: Array.from({ length: 14 }, (_, i) => ({
      title: ['Standup', '1:1 with Sam', 'Interview', 'Planning', 'Focus time'][i % 5] ?? '',
      start: at(now, Math.floor(i / 3), 9 + (i % 3) * 2),
      end: at(now, Math.floor(i / 3), 10 + (i % 3) * 2),
      call: i % 2 === 0,
    })),
    to: at(now, 5, 0),
  },
};

/** Long titles and places stay on one line; a 12-hour clock gets a wider column. */
export const LongAndTwelveHour: Story = {
  args: {
    locale: 'en-US',
    events: [
      {
        title: 'Quarterly business review with the whole leadership team and the board observers',
        start: at(now, 0, 10, 30),
        end: at(now, 0, 12),
        location: 'The large meeting room at the end of the corridor on the fourth floor',
        call: true,
      },
    ],
    to: at(now, 1, 0),
  },
};

/** As it sits in a chat, under the tool row that read it. */
export const InAConversation: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <InChat
      ask="What’s on my calendar today and tomorrow?"
      answer="Five things today, starting with standup at 9:30; the budget sync at 4:30 is the only call after lunch. Tomorrow is quiet: just the dentist first thing."
    >
      <AppTool
        brand="google-calendar"
        app="Google Calendar"
        title="Read your calendar"
        summary="Today and tomorrow"
      >
        <AgendaView events={agenda(now)} from={at(now, 0, 0)} to={at(now, 2, 0)} now={now} />
      </AppTool>
    </InChat>
  ),
};
