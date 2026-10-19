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

/**
 * The page asks you something while you drive (“Remove the mug?”). Conch draws
 * it over the page, under the site's name; the page waits for your answer.
 */
export const ThePageAsks: Story = {
  args: {
    frame: checkoutPage,
    onDialog: fn(),
    tab: {
      url: 'https://shop.example/basket',
      title: 'Your basket',
      control: 'user',
      canGoBack: true,
      dialog: {
        id: 'd1',
        kind: 'confirm',
        message: 'Remove the pearl mug from your basket?',
        site: 'shop.example',
      },
    },
  },
};

const signingIn: BrowserWindowTab = {
  url: 'https://accounts.example.com/signin',
  title: 'Sign in',
  control: 'user',
  canGoBack: true,
};

/** You're in a sign-in box: one press fills it from Passwords (ADR 0130). */
export const FillFromPasswords: Story = {
  args: {
    frame: signInPage,
    tab: signingIn,
    fill: {
      offer: {
        field: 'password',
        site: 'accounts.example.com',
        items: [
          { id: 'pw_1', title: 'Staylight', account: 'ada@example.com' },
          {
            id: 'op_2',
            title: 'Staylight (work)',
            account: 'ada@work.example',
            source: '1password',
          },
        ],
      },
      onFill: fn(),
      onDismiss: fn(),
    },
  },
};

/** A page's own box for a few words. */
export const ThePageAsksForText: Story = {
  args: {
    frame: checkoutPage,
    onDialog: fn(),
    tab: {
      url: 'https://shop.example/basket',
      title: 'Your basket',
      control: 'user',
      dialog: {
        id: 'd2',
        kind: 'prompt',
        message: 'Name your list',
        value: 'Gifts',
        site: 'shop.example',
      },
    },
  },
};

/** A sign-up form: a strong password, made and saved in one press. */
export const SuggestAStrongPassword: Story = {
  args: {
    frame: signInPage,
    tab: { ...signingIn, url: 'https://accounts.example.com/join', title: 'Join' },
    fill: {
      offer: { field: 'new-password', site: 'accounts.example.com', items: [] },
      onGenerate: fn(),
      onDismiss: fn(),
    },
  },
};

/** Find on page, opened with ⌘F (or Ctrl+F): how many, and which one shows. */
export const FindOnPage: Story = {
  render: function Render(args) {
    const [found, setFound] = useState<{ text: string; matches: number; current: number }>();
    return (
      <BrowserWindow
        {...args}
        findKey={1}
        found={found}
        onFind={(text, direction) => {
          args.onFind?.(text, direction);
          setFound((was) => ({
            text,
            matches: text ? 4 : 0,
            current: !text ? 0 : direction && was ? (was.current % 4) + 1 : 1,
          }));
        }}
      />
    );
  },
  args: { tab: { ...hotels, control: 'idle' }, onFind: fn() },
};

/** The assistant at work, with Stop at hand: on a phone the panel covers the chat's own. */
export const Stoppable: Story = {
  args: { running: true, onStop: fn() },
};

/** A page dressed up as one of your sites: said plainly, and nothing is offered. */
export const LooksLikeYourSite: Story = {
  args: {
    frame: signInPage,
    tab: { ...signingIn, url: 'https://staylight.example.account-check.io/signin' },
    fill: {
      offer: {
        field: 'password',
        site: 'staylight.example.account-check.io',
        items: [],
        lookalike: 'staylight.example',
      },
      onDismiss: fn(),
    },
  },
};

const productHunt: BrowserWindowTab = {
  url: 'https://www.producthunt.com/login',
  title: 'Product Hunt',
  control: 'user',
  canGoBack: true,
};

/**
 * Product Hunt is saved as “Sign in with Google” (ADR 0133): no password to
 * fill, so the bar says how it signs in and presses the page’s own button.
 * Google’s pages then fill from the Google login, one question for it all.
 */
export const SignInWithGoogle: Story = {
  args: {
    frame: signInPage,
    tab: productHunt,
    fill: {
      offer: {
        field: 'sign-in',
        site: 'producthunt.com',
        items: [
          { id: 'op_ph', title: 'Product Hunt', account: 'ada@gmail.com', source: '1password' },
        ],
        signIn: {
          via: 'provider',
          provider: 'google',
          name: 'Google',
          account: 'ada@gmail.com',
          button: 'Continue with Google',
          with: { id: 'pw_g', title: 'Google', account: 'ada@gmail.com' },
        },
      },
      onSignIn: fn(),
      onDismiss: fn(),
    },
  },
};

/** Saved as “another account” without saying whose: the page’s ways in, to choose from. */
export const SignInWithAnotherAccount: Story = {
  args: {
    frame: signInPage,
    tab: productHunt,
    fill: {
      offer: {
        field: 'sign-in',
        site: 'producthunt.com',
        items: [
          { id: 'op_ph', title: 'Product Hunt', account: 'ada@gmail.com', source: '1password' },
        ],
        signIn: {
          via: 'provider',
          name: 'another account',
          account: 'ada@gmail.com',
          buttons: ['Continue with Google', 'Continue with Apple', 'Continue with X'],
        },
      },
      onSignIn: fn(),
      onDismiss: fn(),
    },
  },
};

/** On Google’s own page, in Product Hunt’s sign-in: its Google account comes first. */
export const OnTheProvidersPage: Story = {
  args: {
    frame: signInPage,
    tab: {
      ...signingIn,
      url: 'https://accounts.google.com/v3/signin/identifier',
      title: 'Sign in – Google Accounts',
    },
    fill: {
      offer: {
        field: 'username',
        site: 'accounts.google.com',
        for: 'Product Hunt',
        items: [
          { id: 'pw_g', title: 'Google', account: 'ada@gmail.com' },
          { id: 'pw_w', title: 'Google (work)', account: 'ada@work.example' },
        ],
      },
      onFill: fn(),
      onDismiss: fn(),
    },
  },
};

/** A passkey kept in 1Password: said plainly, nothing pretends to work. */
export const PasskeyKeptElsewhere: Story = {
  args: {
    frame: signInPage,
    tab: { ...signingIn, url: 'https://shop.example/signin', title: 'Sign in' },
    fill: {
      offer: {
        field: 'sign-in',
        site: 'shop.example',
        items: [{ id: 'op_s', title: 'Shop', source: '1password' }],
        signIn: { via: 'passkey', name: 'Shop', usable: false, keptIn: '1Password' },
      },
      onSignIn: fn(),
      onDismiss: fn(),
    },
  },
};

/** A company’s single sign-on: the page’s own button, pressed for you. */
export const CompanySignIn: Story = {
  args: {
    frame: signInPage,
    tab: { ...signingIn, url: 'https://linear.app/login', title: 'Linear' },
    fill: {
      offer: {
        field: 'sign-in',
        site: 'linear.app',
        items: [{ id: 'pw_l', title: 'Linear', account: 'ada@acme.example' }],
        signIn: {
          via: 'sso',
          name: 'Acme SSO',
          account: 'ada@acme.example',
          button: 'Continue with SAML SSO',
        },
      },
      onSignIn: fn(),
      onDismiss: fn(),
    },
  },
};

/** Passwords is locked: unlock it, then fill. */
export const PasswordsLocked: Story = {
  args: {
    frame: signInPage,
    tab: signingIn,
    fill: {
      offer: { field: 'username', site: 'accounts.example.com', items: [], locked: true },
      onUnlock: fn(),
      onDismiss: fn(),
    },
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

/** A task's own browser (ADR 0141): its cookies and tabs are nobody else's. */
export const ItsOwnBrowser: Story = {
  args: {
    tab: { ...hotels, control: 'agent', session: { reason: 'task', signedIn: ['booking.com'] } },
  },
};

/** A chat you can give a browser of its own, or take back to your main one. */
export const ChatCanHaveItsOwn: Story = {
  args: { tab: { ...hotels, control: 'idle', session: { reason: 'asked' } }, onSession: fn() },
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
