import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Stack } from '../Stack';
import { Surface } from '../Surface';
import { Switch } from './Switch';

const meta = {
  title: 'Components/Forms/Switch',
  component: Switch,
  args: { label: 'Stream responses' },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md'] } },
  parameters: {
    docs: {
      description: {
        component:
          'Immediate on/off setting. It arrives in its place, and follows data without moving; only a person’s flip plays the spring. Press and hold to feel the thumb stretch toward its destination; release and it springs home.',
      },
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { defaultChecked: true } };

export const States: Story = {
  render: () => (
    <Stack gap={3}>
      <Switch label="Off" />
      <Switch label="On" defaultChecked />
      <Switch label="Disabled" disabled />
      <Switch label="Disabled on" disabled defaultChecked />
      <Switch label="Small" size="sm" defaultChecked />
      <Switch aria-label="Bare switch" />
    </Stack>
  ),
};

export const SettingsList: Story = {
  render: () => (
    <Surface padding={2} radius="xl" style={{ inlineSize: 400 }}>
      <Stack gap={0}>
        {[
          {
            label: 'Notifications',
            description: 'Ping me when a long-running task finishes.',
            on: true,
          },
          {
            label: 'Sound effects',
            description: 'Subtle chimes for approvals and errors.',
            on: false,
          },
          {
            label: 'Extended thinking',
            description: 'Let Claude reason longer on hard problems.',
            on: true,
          },
        ].map((row, i) => (
          <div
            key={row.label}
            style={{
              padding: '12px 14px',
              borderBlockStart: i ? '1px solid var(--nc-border-subtle)' : undefined,
            }}
          >
            <Switch
              label={row.label}
              description={row.description}
              labelPosition="start"
              defaultChecked={row.on}
            />
          </div>
        ))}
      </Stack>
    </Surface>
  ),
};

export const KeyboardToggle: Story = {
  tags: ['!autodocs'],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sw = canvas.getByRole('switch', { name: 'Stream responses' });
    await userEvent.tab();
    await userEvent.keyboard(' ');
    await expect(sw).toBeChecked();
  },
};

/**
 * A switch arrives in its place, and a value that changes by itself (here,
 * data that loaded a moment later) is simply there. Only a person's flip moves it.
 */
export const ArrivesInPlace: Story = {
  tags: ['!autodocs'],
  render: function Render() {
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
      const t = setTimeout(() => setLoaded(true), 50);
      return () => clearTimeout(t);
    }, []);
    return (
      <Stack gap={3}>
        <Switch label="Saved as on" defaultChecked />
        <Switch label="Loaded as on" checked={loaded} onCheckedChange={setLoaded} />
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const saved = canvas.getByRole('switch', { name: 'Saved as on' });
    const loaded = canvas.getByRole('switch', { name: 'Loaded as on' });
    await waitFor(() => expect(loaded).toBeChecked());
    const moving = (el: HTMLElement) =>
      el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length;
    await expect(moving(saved)).toBe(0);
    await expect(moving(loaded)).toBe(0);
    await userEvent.click(saved);
    await expect(saved).toHaveAttribute('data-moving');
  },
};
