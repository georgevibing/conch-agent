import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageSquare, PanelLeft, Settings2 } from 'lucide-react';

import { accents, useNacreTheme, type AccentName } from '../../theme';
import { Button } from '../Button';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { Sheet, type SheetSide } from './Sheet';

const meta = {
  title: 'Components/Overlays/Sheet',
  parameters: {
    docs: {
      description: {
        component:
          'Edge-anchored dialog. Floating by default: it hovers a few pixels off the edge with continuous corners and springs in. Bottom sheets gain a grabber.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Basic({ side, defaultOpen }: { side: SheetSide; defaultOpen?: boolean }) {
  return (
    <Sheet.Root defaultOpen={defaultOpen}>
      <Sheet.Trigger asChild>
        <Button variant="surface">Open {side}</Button>
      </Sheet.Trigger>
      <Sheet.Content side={side}>
        <Sheet.Header>
          <Sheet.Title>Session details</Sheet.Title>
          <Sheet.Description>Started 12 minutes ago on kaltsgea-mbp.</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body>
          <Text size="sm" tone="muted">
            Sheets keep the conversation visible behind them, so they suit inspecting context
            without losing your place.
          </Text>
        </Sheet.Body>
        <Sheet.Footer>
          <Sheet.Close asChild>
            <Button>Done</Button>
          </Sheet.Close>
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  );
}

export const Sides: Story = {
  render: () => (
    <Stack direction="row" gap={3}>
      <Basic side="left" />
      <Basic side="right" />
      <Basic side="bottom" />
    </Stack>
  ),
};

export const OpenRight: Story = {
  tags: ['!autodocs'],
  render: () => <Basic side="right" defaultOpen />,
};

export const OpenBottom: Story = {
  tags: ['!autodocs'],
  render: () => <Basic side="bottom" defaultOpen />,
};

const sessions = [
  ['Refactor auth flow', '2m ago'],
  ['Fix flaky websocket test', '1h ago'],
  ['Design token audit', 'Yesterday'],
  ['Migrate to Vite 8', 'Mon'],
];

export const SessionList: Story = {
  render: () => (
    <Sheet.Root>
      <Sheet.Trigger asChild>
        <Button variant="surface" leadingIcon={<PanelLeft />}>
          Sessions
        </Button>
      </Sheet.Trigger>
      <Sheet.Content side="left" size="sm">
        <Sheet.Header>
          <Sheet.Title>Sessions</Sheet.Title>
        </Sheet.Header>
        <Sheet.Body>
          <Stack as="ul" gap={1}>
            {sessions.map(([title, when]) => (
              <li key={title}>
                <Button variant="ghost" block style={{ justifyContent: 'flex-start' }}>
                  <MessageSquare size={15} />
                  <span style={{ flex: 1, textAlign: 'start' }}>{title}</span>
                  <Text as="span" size="xs" tone="subtle">
                    {when}
                  </Text>
                </Button>
              </li>
            ))}
          </Stack>
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  ),
};

function AccentPicker() {
  const { accent, setTheme } = useNacreTheme();
  return (
    <Stack direction="row" gap={2} wrap role="group" aria-label="Accent colour">
      {(Object.keys(accents) as AccentName[]).map((name) => (
        <Button
          key={name}
          size="sm"
          variant={accent === name ? 'solid' : 'surface'}
          aria-pressed={accent === name}
          onClick={() => setTheme({ accent: name })}
        >
          {name}
        </Button>
      ))}
    </Stack>
  );
}

export const Settings: Story = {
  render: () => (
    <Sheet.Root>
      <Sheet.Trigger asChild>
        <Button variant="surface" leadingIcon={<Settings2 />}>
          Settings
        </Button>
      </Sheet.Trigger>
      <Sheet.Content side="right">
        <Sheet.Header>
          <Sheet.Title>Appearance</Sheet.Title>
          <Sheet.Description>Changes apply instantly across every open session.</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body>
          <Stack gap={3}>
            <Text size="sm" weight="medium">
              Accent
            </Text>
            <AccentPicker />
          </Stack>
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  ),
};
