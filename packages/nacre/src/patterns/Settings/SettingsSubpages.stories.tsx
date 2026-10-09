import type { Meta, StoryObj } from '@storybook/react-vite';
import { Gauge, Power } from 'lucide-react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Breadcrumb } from '../../components/Breadcrumb';
import { Stack } from '../../components/Stack';
import { Switch } from '../../components/Switch';
import { Heading, Text } from '../../components/Text';
import { SettingsRow, SettingsSubpages } from './SettingsSubpages';

const meta = {
  title: 'Patterns/Settings/SettingsSubpages',
  component: SettingsSubpages,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A place in Settings with a page inside it, the way a phone’s settings drill in. One row — its name, where things stand and a chevron — opens the page, which slides in from the side the chevron points to. The trail above is the way back: stepping back slides the place in from the other side, with the focus on the row it came from. Arriving by an address, the page is simply there; reduced motion makes every move instant.',
      },
    },
  },
  args: { children: null },
  decorators: [(Story) => <div style={{ maxInlineSize: '36rem' }}>{Story()}</div>],
} satisfies Meta<typeof SettingsSubpages>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Settings → Health, with Always on a page of its own. */
function Place({ startAt = null }: { startAt?: string | null }) {
  const [page, setPage] = useState<string | null>(startAt);
  return (
    <Stack gap={4}>
      <Breadcrumb>
        {page ? (
          <>
            <Breadcrumb.Item onClick={() => setPage(null)}>Health</Breadcrumb.Item>
            <Breadcrumb.Item current>Always on</Breadcrumb.Item>
          </>
        ) : (
          <Breadcrumb.Item current>Health</Breadcrumb.Item>
        )}
      </Breadcrumb>
      <SettingsSubpages page={page}>
        {page ? (
          <Stack gap={4}>
            <Heading level={3} size="lg">
              Always on
            </Heading>
            <Switch labelPosition="start" label="Show Conch in the menu bar" defaultChecked />
            <Switch labelPosition="start" label="Keep running after you log out" />
            <Switch labelPosition="start" label="Keep this Mac awake" defaultChecked />
          </Stack>
        ) : (
          <Stack gap={4}>
            <Heading level={3} size="lg">
              Health
            </Heading>
            <Text size="sm" tone="muted">
              Every part of Conch is working.
            </Text>
            <SettingsRow
              page="always-on"
              icon={<Power />}
              label="Always on"
              description="The menu bar, after you log out, keeping awake, quitting"
              value="On"
              onClick={() => setPage('always-on')}
            />
          </Stack>
        )}
      </SettingsSubpages>
    </Stack>
  );
}

/** Open the page and step back: it slides in, and the focus comes home to the row. */
export const Playground: Story = {
  render: () => <Place />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Always on/ }));
    await expect(canvas.getByRole('switch', { name: 'Keep this Mac awake' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Health' }));
    await expect(canvas.getByRole('button', { name: /Always on/ })).toHaveFocus();
  },
};

/** Arriving at the page by its address: it's simply there, nothing sliding. */
export const ArrivedOnThePage: Story = {
  render: () => <Place startAt="always-on" />,
  play: async ({ canvasElement }) => {
    const running = canvasElement
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running');
    await expect(running).toHaveLength(0);
  },
};

/** The rows on their own: on a page, and inside a card that draws its own edge. */
export const Rows: Story = {
  render: () => (
    <Stack gap={4}>
      <SettingsRow label="Limits" value="Long turns off" icon={<Gauge />} />
      <SettingsRow label="Limits" description="Long turns, routines and learning" value="3 set" />
      <SettingsRow label="Topics" value="4 of 6" variant="plain" />
      <SettingsRow label="Not now" value="Off" disabled />
    </Stack>
  ),
};
