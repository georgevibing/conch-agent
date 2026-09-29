import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Stack } from '../../components/Stack';
import { BrowserApproval } from './BrowserApproval';
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
