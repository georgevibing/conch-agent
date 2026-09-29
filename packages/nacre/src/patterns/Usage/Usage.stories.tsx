import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ReactNode } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Popover } from '../../components/Popover';
import { Stack } from '../../components/Stack';
import { Surface } from '../../components/Surface';
import { Text } from '../../components/Text';
import { usageFixtures, usageNow } from './fixtures';
import type { UsageValue } from './types';
import { UsageMeter } from './UsageMeter';
import { UsageNotice } from './UsageNotice';
import { UsagePanel } from './UsagePanel';
import { UsageRing } from './UsageRing';

type FixtureName = keyof typeof usageFixtures;
const fixtureNames = Object.keys(usageFixtures) as FixtureName[];

/** A popover-like box so the panel reads as it would in the header. */
function PanelBox({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <Stack gap={2}>
      {caption && (
        <Text size="xs" tone="subtle">
          {caption}
        </Text>
      )}
      <Surface elevation={3} radius="lg" padding={0} style={{ overflow: 'hidden' }}>
        {children}
      </Surface>
    </Stack>
  );
}

function Refreshable({ value, ...rest }: { value: UsageValue; onSetBudget?: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <UsagePanel
      value={value}
      now={usageNow}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 1400);
      }}
      {...rest}
    />
  );
}

interface PlaygroundArgs {
  fixture: FixtureName;
}

const meta = {
  title: 'Patterns/Chat/Usage',
  component: UsageMeter,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: [
          'A fuel gauge for “how much can I still do?”. The header shows **one number** — what’s *left* of the tightest limit — and a ring that drains toward empty, like a battery. Everything speaks in what’s left (“62% left”), never in what’s used.',
          'Plans (Claude Pro/Max) have rolling windows; the most-used one leads the chip, the rest wait in the popover in a stable order. Pay-as-you-go (API key, Bedrock, Vertex) has no provider ceiling, so the chip shows today’s spend — or what’s left of your own monthly budget if you set one.',
          'Calm by default: the ring is the accent colour until a limit reaches 75% used (warning) and 90% (critical). Colour always travels with words, and the notice above the composer only appears when things get tight.',
        ].join('\n\n'),
      },
    },
  },
  args: { value: usageFixtures.planHealthy, now: usageNow },
} satisfies Meta<typeof UsageMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: StoryObj<PlaygroundArgs> = {
  args: { fixture: 'planHealthy' },
  argTypes: { fixture: { control: 'select', options: fixtureNames } },
  render: ({ fixture }) => {
    const value = usageFixtures[fixture];
    return (
      <Stack gap={4} align="start" style={{ inlineSize: '22rem' }}>
        <UsageMeter value={value} now={usageNow} />
        <PanelBox>
          <Refreshable value={value} onSetBudget={() => {}} />
        </PanelBox>
        <div style={{ inlineSize: '100%' }}>
          <UsageNotice value={value} now={usageNow} onOpen={() => {}} onDismiss={() => {}} />
        </div>
      </Stack>
    );
  },
};

const headerRow = (name: FixtureName, label: string) => (
  <Stack key={name} direction="row" gap={3} align="center" justify="between">
    <Text size="xs" tone="subtle" style={{ minInlineSize: '9rem' }}>
      {label}
    </Text>
    <UsageMeter value={usageFixtures[name]} now={usageNow} />
  </Stack>
);

export const MeterStates: Story = {
  name: 'Meter states',
  render: () => (
    <Surface variant="flat" radius="lg" padding={4} style={{ inlineSize: '20rem' }}>
      <Stack gap={3}>
        {headerRow('planHealthy', 'Plan · healthy')}
        {headerRow('planWarning', 'Plan · warning')}
        {headerRow('planExhausted', 'Plan · limit reached')}
        {headerRow('planNoWindows', 'Plan · no windows')}
        {headerRow('meteredNoBudget', 'Metered · no budget')}
        {headerRow('meteredBudget', 'Metered · budget')}
        {headerRow('meteredCritical', 'Metered · nearly spent')}
        {headerRow('meteredOverBudget', 'Metered · over budget')}
        {headerRow('usageUnknown', 'Not ready')}
      </Stack>
    </Surface>
  ),
};

export const Rings: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      <UsageRing percentLeft={62} size="sm" />
      <UsageRing percentLeft={62} />
      <UsageRing percentLeft={62} size="md" />
      <UsageRing percentLeft={62} size="lg" />
      <UsageRing percentLeft={18} severity="warning" size="lg" />
      <UsageRing percentLeft={6} severity="critical" size="lg" />
      <UsageRing percentLeft={0} severity="exhausted" size="lg" />
      <UsageRing size="lg" />
    </Stack>
  ),
};

export const PanelPlan: Story = {
  name: 'Panel · plan',
  render: () => (
    <Stack direction="row" gap={6} align="start" wrap>
      <PanelBox caption="Healthy">
        <Refreshable value={usageFixtures.planHealthy} />
      </PanelBox>
      <PanelBox caption="Warning">
        <Refreshable value={usageFixtures.planWarning} />
      </PanelBox>
      <PanelBox caption="Limit reached">
        <Refreshable value={usageFixtures.planExhausted} />
      </PanelBox>
      <PanelBox caption="With extra usage">
        <Refreshable value={usageFixtures.planWithExtra} />
      </PanelBox>
      <PanelBox caption="Limits not visible">
        <Refreshable value={usageFixtures.planNoWindows} />
      </PanelBox>
    </Stack>
  ),
};

export const PanelMetered: Story = {
  name: 'Panel · metered',
  render: () => (
    <Stack direction="row" gap={6} align="start" wrap>
      <PanelBox caption="No budget">
        <Refreshable value={usageFixtures.meteredNoBudget} onSetBudget={() => {}} />
      </PanelBox>
      <PanelBox caption="Budget">
        <Refreshable value={usageFixtures.meteredBudget} onSetBudget={() => {}} />
      </PanelBox>
      <PanelBox caption="Over budget">
        <Refreshable value={usageFixtures.meteredOverBudget} onSetBudget={() => {}} />
      </PanelBox>
    </Stack>
  ),
};

export const PanelUnknown: Story = {
  name: 'Panel · not ready',
  render: () => (
    <PanelBox>
      <Refreshable value={usageFixtures.usageUnknown} />
    </PanelBox>
  ),
};

export const NoticeStates: Story = {
  name: 'Notice states',
  render: () => (
    <Stack gap={3} style={{ inlineSize: '36rem' }}>
      <UsageNotice value={usageFixtures.planWarning} now={usageNow} onOpen={() => {}} />
      <UsageNotice
        value={usageFixtures.planExhausted}
        now={usageNow}
        onOpen={() => {}}
        onDismiss={() => {}}
      />
      <UsageNotice value={usageFixtures.meteredCritical} now={usageNow} onDismiss={() => {}} />
      <UsageNotice value={usageFixtures.meteredOverBudget} now={usageNow} onOpen={() => {}} />
      <Text size="xs" tone="subtle">
        Healthy plans and budget-free pay-as-you-go render nothing.
      </Text>
    </Stack>
  ),
};

function Header({ value, defaultOpen }: { value: UsageValue; defaultOpen?: boolean }) {
  return (
    <Surface
      variant="flat"
      radius="lg"
      padding={3}
      style={{ inlineSize: '34rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
    >
      <Text weight="semibold" size="sm" style={{ flex: 1 }}>
        Refactor the gateway
      </Text>
      <Popover.Root defaultOpen={defaultOpen}>
        <Popover.Trigger asChild>
          <UsageMeter value={value} now={usageNow} />
        </Popover.Trigger>
        <Popover.Content
          align="end"
          padding="none"
          aria-label="Usage"
          // Land on the panel itself, not the refresh button (and its tooltip).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <Refreshable value={value} onSetBudget={() => {}} />
        </Popover.Content>
      </Popover.Root>
    </Surface>
  );
}

export const InHeader: Story = {
  name: 'In header',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ paddingBlockEnd: '24rem', display: 'grid', justifyContent: 'center' }}>
      <Header value={usageFixtures.planHealthy} defaultOpen />
    </div>
  ),
};

export const InHeaderMetered: Story = {
  name: 'In header · metered',
  parameters: { layout: 'padded' },
  render: () => (
    <div style={{ paddingBlockEnd: '20rem', display: 'grid', justifyContent: 'center' }}>
      <Header value={usageFixtures.meteredBudget} defaultOpen />
    </div>
  ),
};

export const KeyboardOpen: Story = {
  tags: ['!autodocs'],
  render: () => <Header value={usageFixtures.planWarning} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    const meter = canvas.getByRole('button', { name: /^Usage: 12% left/ });
    await expect(meter).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('dialog', { name: 'Usage' })).toBeInTheDocument();
  },
};
