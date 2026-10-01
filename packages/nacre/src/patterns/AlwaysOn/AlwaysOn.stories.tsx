import type { Meta, StoryObj } from '@storybook/react-vite';
import { Power } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { AlwaysOn } from './AlwaysOn';

const quit = (
  <Button size="sm" variant="surface" leadingIcon={<Power />}>
    Quit Conch
  </Button>
);

const meta = {
  title: 'Patterns/Health/AlwaysOn',
  component: AlwaysOn,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Always on: Conch starts when you log in and keeps running with no window, so routines run on time and your phone and chat apps can reach it. One switch, and a quiet status line like a phone’s (“● Running in the background since 9:14 AM”). Off is never an alarm: when something you set up only works while Conch runs, it says so once, beside the switch that fixes it.',
      },
    },
  },
  args: {
    on: false,
    running: 'window',
    since: '9:14 AM',
    place: 'System Settings → General → Login Items',
    onOnChange: () => undefined,
  },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof AlwaysOn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [on, setOn] = useState(args.on);
    const [busy, setBusy] = useState(false);
    return (
      <AlwaysOn
        {...args}
        on={on}
        busy={busy}
        running={on ? 'background' : args.running}
        onOnChange={(next) => {
          setBusy(true);
          setTimeout(() => {
            setOn(next);
            setBusy(false);
          }, 1200);
        }}
      >
        {on ? quit : undefined}
      </AlwaysOn>
    );
  },
};

/** The usual start: Conch in a Terminal window. */
export const InAWindow: Story = {};

/** A routine is on, so closing the window would stop it: said once, quietly. */
export const SomethingNeedsIt: Story = {
  args: { needed: 'Your 2 routines and Telegram only work while Conch is running.' },
};

export const On: Story = {
  args: { on: true, running: 'background', since: 'yesterday', children: quit },
};

export const Moving: Story = { args: { busy: true } };

/** Turned off from the background Conch: it keeps going until you quit it. */
export const OffButRunning: Story = {
  args: { running: 'background', children: quit },
};

export const Problem: Story = {
  args: {
    on: true,
    problem: {
      message:
        'Conch will start when you log in, but couldn’t start in the background just now: “Conch needs Node.js 24 or newer and couldn’t find it.” This window keeps it running meanwhile.',
      command: 'tail -n 40 "/Users/you/.conch/logs/conch.log"',
    },
  },
};

export const TurnedOffByTheComputer: Story = {
  args: {
    on: true,
    running: 'background',
    problem: {
      message:
        'Conch is turned off in System Settings → General → Login Items, so it won’t start when you log in. Turn Conch on there.',
      command: 'open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"',
    },
  },
};

export const Unavailable: Story = {
  args: {
    running: 'dev',
    unsupported: 'Always on is for Conch itself (pnpm start), not a development server.',
  },
};

/** On, with how it runs: the menu bar, after logging out, staying awake (ADR 0029). */
export const WithOptions: Story = {
  args: {
    on: true,
    running: 'background',
    since: 'yesterday',
    children: quit,
    options: (
      <>
        <Switch
          labelPosition="start"
          defaultChecked
          label="Show Conch in the menu bar"
          description="Whether it’s running, and a dot when something needs you."
        />
        <Switch
          labelPosition="start"
          label="Keep this Mac awake"
          description="On mains power, it won’t sleep while Conch runs, so routines and your phone always reach it."
        />
      </>
    ),
  },
};
