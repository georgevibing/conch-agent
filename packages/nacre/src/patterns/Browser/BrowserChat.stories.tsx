import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { BrowserApproval } from './BrowserApproval';
import { BrowserFill } from './BrowserFill';
import { BrowserHandoff } from './BrowserHandoff';
import { BrowserTrail } from './BrowserTrail';
import { checkoutPage, hotelsPage, placeOrderBox, trailSteps } from './fixtures';

const meta = {
  title: 'Patterns/Browser/In the chat',
  component: BrowserTrail,
  args: { steps: trailSteps, onShow: fn() },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'How browsing reads in the transcript. A trail is a filmstrip of what the assistant saw that grows as it goes; the step in progress shimmers at the end, and hovering a frame shows it bigger. Questions appear in place: a new site is asked about once (this chat, or always), and anything significant is asked every time, with the very control marked on the page. When only you can do something, a “Your turn” card waits for you.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: 640, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BrowserTrail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trail: Story = {};

export const WaitingForApproval: Story = {
  args: {
    steps: [
      ...trailSteps.slice(0, 2),
      {
        id: 'waiting',
        status: 'waiting',
        label: 'Waiting for your approval',
        url: 'https://www.staylight.example/lisbon',
      },
    ],
  },
};

export const WaitingForYou: Story = {
  args: {
    steps: [
      {
        id: 'waiting',
        status: 'waiting',
        label: 'Waiting for you to hand the browser back',
        url: 'https://www.staylight.example/lisbon',
      },
    ],
  },
};

export const WaitingForPreviousStep: Story = {
  args: {
    steps: [
      { id: 'waiting', status: 'waiting', label: 'Waiting for the previous browser step', url: '' },
    ],
  },
};

export const StepTimedOut: Story = {
  args: {
    steps: [
      {
        id: 'timeout',
        status: 'error',
        label:
          'The browser took too long and this step was stopped. Check the page before repeating the action.',
        url: 'https://www.staylight.example/lisbon',
      },
    ],
  },
};

export const TrailDone: Story = {
  args: {
    steps: trailSteps.map((s) =>
      s.status === 'running'
        ? { ...s, status: 'done', label: 'Clicked “See availability”', shot: hotelsPage }
        : s,
    ),
  },
};

export const TrailOpen: Story = { args: { defaultOpen: true } };

export const TrailWithAnError: Story = {
  args: {
    steps: [
      ...trailSteps.slice(0, 3),
      {
        id: 'e1',
        status: 'error',
        label:
          'Clicking “Book”: Something is covering that element (<div class="modal">). Close it first.',
        url: 'https://www.staylight.example/lisbon',
        shot: hotelsPage,
      },
    ],
  },
};

export const AskAboutASite: Story = {
  render: () => (
    <BrowserApproval
      kind="site"
      site="staylight.example"
      action="Click “See availability”"
      shot={hotelsPage}
      box={{ x: 1060 / 1280, y: 316 / 800, width: 156 / 1280, height: 36 / 800 }}
      onDecide={fn()}
    />
  ),
};

export const ConfirmSomethingSignificant: Story = {
  render: () => (
    <BrowserApproval
      kind="high-stakes"
      site="shopwise.example"
      action="Click “Place order”"
      shot={checkoutPage}
      box={placeOrderBox}
      onDecide={fn()}
    />
  ),
};

export const ConfirmADownload: Story = {
  render: () => (
    <BrowserApproval
      kind="download"
      site="bank.example"
      action="Download statement-october.pdf"
      onDecide={fn()}
    />
  ),
};

export const ConfirmAnUpload: Story = {
  render: () => (
    <BrowserApproval
      kind="upload"
      site="jobs.example"
      action="Upload “cv.pdf” (attached in this chat)"
      onDecide={fn()}
    />
  ),
};

/** One question for a whole sign-in, from Passwords (ADR 0130). */
export const SignInFromPasswords: Story = {
  render: () => (
    <BrowserApproval
      kind="fill"
      fill="sign-in"
      site="staylight.example"
      action="Sign in as ada@example.com"
      onDecide={fn()}
    />
  ),
};

/** Several accounts saved for the site: pick one, in one tap. */
export const ChooseAnAccount: Story = {
  render: () => (
    <BrowserApproval
      kind="fill"
      fill="sign-in"
      site="google.com"
      action="Sign in"
      savedFor="accounts.google.com"
      accounts={[
        { id: 'pw_1', title: 'Google', account: 'ada@gmail.com' },
        { id: 'op_2', title: 'Google (work)', account: 'ada@work.example', source: '1password' },
      ]}
      onDecide={fn()}
      onChoose={fn()}
    />
  ),
};

/** On Google’s page, for Product Hunt (ADR 0133): one question for the whole sign-in. */
export const SignInThroughGoogle: Story = {
  render: () => (
    <BrowserApproval
      kind="fill"
      fill="sign-in"
      site="accounts.google.com"
      action="Sign in to “Product Hunt” with Google as ada@gmail.com"
      signingInTo="Product Hunt"
      onDecide={fn()}
    />
  ),
};

/**
 * The live view's bar for sites that sign in another way (ADR 0133), as it
 * wraps on a phone: with Google, with an account Passwords doesn’t name, a
 * passkey kept in 1Password, and Google’s own page for a site.
 */
export const SignInBars: Story = {
  render: () => (
    <Stack gap={3}>
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'producthunt.com',
          items: [{ id: 'op_ph', title: 'Product Hunt', account: 'ada@gmail.com' }],
          signIn: {
            via: 'provider',
            provider: 'google',
            name: 'Google',
            account: 'ada@gmail.com',
            button: 'Continue with Google',
            with: { id: 'pw_g', title: 'Google', account: 'ada@gmail.com' },
          },
        }}
        onSignIn={fn()}
        onDismiss={fn()}
      />
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'producthunt.com',
          items: [{ id: 'op_ph', title: 'Product Hunt', account: 'ada@gmail.com' }],
          signIn: {
            via: 'provider',
            name: 'another account',
            account: 'ada@gmail.com',
            buttons: ['Continue with Google', 'Continue with Apple'],
          },
        }}
        onSignIn={fn()}
        onDismiss={fn()}
      />
      <BrowserFill
        offer={{
          field: 'sign-in',
          site: 'shop.example',
          items: [{ id: 'op_s', title: 'Shop' }],
          signIn: { via: 'passkey', name: 'Shop', usable: false, keptIn: '1Password' },
        }}
        onDismiss={fn()}
      />
      <BrowserFill
        offer={{
          field: 'username',
          site: 'accounts.google.com',
          for: 'Product Hunt',
          items: [
            { id: 'pw_g', title: 'Google', account: 'ada@gmail.com' },
            { id: 'pw_w', title: 'Google (work)', account: 'ada@work.example' },
          ],
        }}
        onFill={fn()}
        onDismiss={fn()}
      />
    </Stack>
  ),
};

/** A sign-up: Conch makes a strong password, saves it, and types it in. */
export const MakeANewPassword: Story = {
  render: () => (
    <BrowserApproval
      kind="fill"
      fill="new-password"
      site="staylight.example"
      action="Make a strong password for staylight.example"
      onDecide={fn()}
    />
  ),
};

/** In your own Chrome: the card says so, and a site is never allowed for good. */
export const AskInYourChrome: Story = {
  render: () => (
    <BrowserApproval
      kind="site"
      site="bank.example"
      action="Click “Statements”"
      ownChrome
      onDecide={fn()}
    />
  ),
};

export const Answered: Story = {
  render: () => (
    <Stack gap={3}>
      <BrowserApproval
        kind="site"
        site="staylight.example"
        action="Click “Search”"
        decision="allow"
      />
      <BrowserApproval
        kind="site"
        site="staylight.example"
        action="Click “Search”"
        decision="allow-always"
      />
      <BrowserApproval
        kind="high-stakes"
        site="shopwise.example"
        action="Click “Place order”"
        decision="deny"
      />
      <BrowserHandoff reason="Sign in to your Staylight account" state="done" />
      <BrowserHandoff reason="Solve the check on Staylight" state="done" auto />
    </Stack>
  ),
};

export const YourTurn: Story = {
  render: () => (
    <BrowserHandoff
      reason="Sign in to your Staylight account, then hand the browser back."
      state="waiting"
      onShow={fn()}
      onDone={fn()}
    />
  ),
};

/** A realistic run: the trail, a question on the way, and a handoff. */
export const Together: Story = {
  render: () => (
    <Stack gap={4}>
      <BrowserTrail steps={trailSteps.slice(0, 4)} onShow={fn()} />
      <BrowserApproval
        kind="high-stakes"
        site="shopwise.example"
        action="Click “Place order”"
        shot={checkoutPage}
        box={placeOrderBox}
        onDecide={fn()}
      />
      <BrowserHandoff
        reason="Confirm the payment in your banking app"
        state="waiting"
        onShow={fn()}
        onDone={fn()}
      />
    </Stack>
  ),
};
