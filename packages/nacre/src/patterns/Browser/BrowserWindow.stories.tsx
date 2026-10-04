import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';

import { BrowserWindow, type BrowserWindowAction, type BrowserWindowTab } from './BrowserWindow';
import {
  availabilityBox,
  checkoutPage,
  hotelsPage,
  passwordBox,
  placeOrderBox,
  signInPage,
} from './fixtures';

const hotels: BrowserWindowTab = {
  url: 'https://www.staylight.example/lisbon?checkin=2026-10-12&guests=2',
  title: 'Hotels in Lisbon · Staylight',
  canGoBack: true,
  control: 'agent',
};

const meta = {
  title: 'Patterns/Browser/BrowserWindow',
  component: BrowserWindow,
  args: {
    tab: hotels,
    frame: hotelsPage,
    name: 'Conch',
    onNavigate: fn(),
    onHistory: fn(),
    onInput: fn(),
    onTakeOver: fn(),
    onHandBack: fn(),
    onClose: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The browser as a window in the chat. The page streams in live; a small pearl — the assistant’s hand — glides on a spring to whatever it’s about to touch, the control lights up, and a caption says what’s happening. Click into the page (or press “Take over”) to drive yourself: mouse, wheel, keyboard and paste go straight to the page, and the assistant waits until you hand back. When it needs you for something only you should do (signing in, a payment), the window says “Your turn” and its screen wears an orbiting pearl rim until you’re done.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 760, blockSize: 540, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BrowserWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    action: { key: 1, action: 'click', label: 'Clicking “See availability”', box: availabilityBox },
  },
};

/** The assistant at work: its cursor moves from control to control, captioned. */
export const Watching: Story = {
  render: function Render(args) {
    const script: (BrowserWindowAction & { frame: string; tab: Partial<BrowserWindowTab> })[] = [
      {
        key: 0,
        action: 'click',
        label: 'Clicking “See availability”',
        box: availabilityBox,
        frame: hotelsPage,
        tab: hotels,
      },
      {
        key: 1,
        action: 'click',
        label: 'Clicking “Place order”',
        box: placeOrderBox,
        frame: checkoutPage,
        tab: { url: 'https://shopwise.example/checkout', title: 'Checkout' },
      },
      { key: 2, action: 'scroll', label: 'Scrolling down', frame: checkoutPage, tab: {} },
    ];
    const [index, setIndex] = useState(0);
    useEffect(() => {
      const timer = setInterval(() => setIndex((i) => i + 1), 2_800);
      return () => clearInterval(timer);
    }, []);
    const step = script[index % script.length] as (typeof script)[number];
    return (
      <BrowserWindow
        {...args}
        frame={step.frame}
        tab={{ ...hotels, ...step.tab, loading: index % 3 === 1 }}
        action={{ ...step, key: index }}
      />
    );
  },
};

export const YouAreDriving: Story = {
  args: { tab: { ...hotels, control: 'user' } },
};

/** The assistant needs you to sign in. It waits, and never sees what you type. */
export const YourTurn: Story = {
  args: {
    frame: signInPage,
    tab: {
      url: 'https://accounts.example.com/signin',
      title: 'Sign in',
      control: 'user',
      canGoBack: true,
      handoff: { reason: 'Sign in to your Staylight account, then hand the browser back.' },
    },
    action: { key: 3, action: 'type', label: 'Waiting for you', box: passwordBox },
  },
};

/** The site's icon, as the gateway sends it: a small image inline. */
const staylightIcon =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iNCIgZmlsbD0iIzBiNmU0ZiIvPjxwYXRoIGQ9Ik00IDExVjVoM2EyIDIgMCAwIDEgMCA0SDUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjYiIGZpbGw9Im5vbmUiLz48L3N2Zz4=';

/**
 * Tabs sit above the toolbar, as in any browser: each with its site's icon, a
 * spinner while it loads. Links that open a new tab, and sign-in popups, become
 * tabs too. Right-click one for the rest.
 */
export const Tabs: Story = {
  args: {
    onTab: fn(),
    tab: {
      ...hotels,
      control: 'idle',
      tabs: [
        {
          id: 't1',
          title: 'Hotels in Lisbon · Staylight',
          url: hotels.url,
          active: false,
          icon: staylightIcon,
        },
        {
          id: 't2',
          title: 'Casa do Rio · Staylight',
          url: 'https://www.staylight.example/hotel/0',
          active: true,
          icon: staylightIcon,
        },
        {
          id: 't3',
          title: '',
          url: 'https://accounts.example.com/signin',
          active: false,
          loading: true,
        },
      ],
    },
  },
};

/** After a restart: the chat's tabs open again where they were. */
export const Restoring: Story = {
  args: { tab: null, frame: undefined, phase: 'restoring', onTab: fn() },
};

/** Working in your own Chrome, where you’re signed in: the window says so. */
export const InYourChrome: Story = {
  args: { tab: { ...hotels, control: 'agent', backend: 'chrome' } },
};

/** A browser in the cloud. */
export const InTheCloud: Story = {
  args: { tab: { ...hotels, control: 'agent', backend: 'browserbase' } },
};

export const Idle: Story = {
  args: { tab: { ...hotels, control: 'idle' } },
};

export const NothingOpenYet: Story = {
  args: { tab: null, frame: undefined },
};

export const Installing: Story = {
  args: {
    tab: null,
    frame: undefined,
    phase: 'installing',
    install: { percent: 42, label: 'Downloading Chromium · 42% of 170.3 MiB' },
  },
};

export const Starting: Story = {
  args: { tab: null, frame: undefined, phase: 'starting' },
};

export const NeedsAHand: Story = {
  args: {
    tab: null,
    frame: undefined,
    phase: 'problem',
    problem: {
      message: 'The browser needs a few system libraries that aren’t installed.',
      command: 'sudo npx playwright install-deps chromium',
      actionLabel: 'Repair',
      onAction: fn(),
    },
  },
};

/** Squeezed into a narrow chat panel: the chrome gives way, the page keeps its shape. */
export const NarrowPanel: Story = {
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 420, blockSize: 420 }}>
        <Story />
      </div>
    ),
  ],
};
