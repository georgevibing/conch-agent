import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Breadcrumb } from '../../components/Breadcrumb';
import { SettingsSubpages } from '../Settings/SettingsSubpages';
import { AddToHomeScreen } from './AddToHomeScreen';
import { NotifiedDevices } from './NotifiedDevices';
import {
  NotifyThisDevice,
  NotifyTopics,
  type NotifyState,
  type NotifyTopic,
} from './NotifyThisDevice';

const meta = {
  title: 'Patterns/Notifications/NotifyThisDevice',
  component: NotifyThisDevice,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Notifications on this device: one switch. While it’s on, what it’s told about opens beneath it as a short list — and folds away when it’s off, because it means nothing then. When the device needs something first — the Home Screen on an iPhone, the browser’s own permission — it says exactly that, in a line. Conch only notifies when nobody is looking at it.',
      },
    },
  },
  args: { state: 'off', onChange: () => undefined, onTest: () => undefined },
  decorators: [(Story) => <div style={{ maxInlineSize: 600 }}>{Story()}</div>],
} satisfies Meta<typeof NotifyThisDevice>;

export default meta;
type Story = StoryObj<typeof meta>;

const TOPICS: NotifyTopic[] = [
  { id: 'approvals', label: 'It needs you', on: true },
  { id: 'replies', label: 'An answer is ready', on: true },
  { id: 'routines', label: 'A routine runs', on: true },
  { id: 'tasks', label: 'A task finishes', on: true },
  { id: 'devices', label: 'A device asks to sign in', on: true },
  { id: 'updates', label: 'There’s a new version', on: false },
];

/** What a device chooses, kept as it would be by Conch. */
function useChoices() {
  const [topics, setTopics] = useState(TOPICS);
  const [previews, setPreviews] = useState(true);
  return {
    topics,
    onTopicChange: (id: string, on: boolean) =>
      setTopics((all) => all.map((t) => (t.id === id ? { ...t, on } : t))),
    previews,
    onPreviewsChange: setPreviews,
  };
}

/** Turn it on and off: what it's told about opens beneath it, and folds away. */
export const Playground: Story = {
  render: function Render(args) {
    const [state, setState] = useState<NotifyState>(args.state);
    const [busy, setBusy] = useState(false);
    const choices = useChoices();
    return (
      <NotifyThisDevice
        {...args}
        {...(state === 'on' ? choices : {})}
        state={state}
        busy={busy}
        onChange={(on) => {
          setBusy(true);
          setTimeout(() => {
            setState(on ? 'on' : 'off');
            setBusy(false);
          }, 900);
        }}
      />
    );
  },
};

export const Off: Story = {};

/** Saved as on, it opens as on: the switch in place, the list already open, nothing moving. */
export const On: Story = {
  args: { state: 'on' },
  render: function Render(args) {
    return <NotifyThisDevice {...args} {...useChoices()} />;
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('region', { name: 'Allow notifications' });
    await expect(within(card).getByRole('switch', { name: 'Allow notifications' })).toBeChecked();
    const running = card.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
    await expect(running).toHaveLength(0);
  },
};

/**
 * As Settings shows it: the topics on a page of their own. The card keeps the
 * switch, the previews and one Topics row; the row slides the six switches in,
 * and the trail above is the way back.
 */
export const TopicsOnTheirOwnPage: Story = {
  args: { state: 'on' },
  render: function Render(args) {
    const choices = useChoices();
    const [page, setPage] = useState<string | null>(null);
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Breadcrumb>
          {page ? (
            <>
              <Breadcrumb.Item onClick={() => setPage(null)}>Notifications</Breadcrumb.Item>
              <Breadcrumb.Item current>Topics</Breadcrumb.Item>
            </>
          ) : (
            <Breadcrumb.Item current>Notifications</Breadcrumb.Item>
          )}
        </Breadcrumb>
        <SettingsSubpages page={page}>
          {page ? (
            <NotifyTopics topics={choices.topics} onTopicChange={choices.onTopicChange} />
          ) : (
            <NotifyThisDevice {...args} {...choices} onOpenTopics={() => setPage('topics')} />
          )}
        </SettingsSubpages>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /Topics/ })).toHaveTextContent('5 of 6');
    await userEvent.click(canvas.getByRole('button', { name: /Topics/ }));
    await expect(canvas.getByRole('group', { name: 'Tell me when' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Notifications' }));
    await expect(canvas.getByRole('button', { name: /Topics/ })).toHaveFocus();
  },
};

export const InstallFirst: Story = {
  args: { state: 'install', children: <AddToHomeScreen /> },
};
export const Blocked: Story = { args: { state: 'blocked' } };
export const Unsupported: Story = {
  args: {
    state: 'unsupported',
    detail: 'Needs Conch’s secure (https) address. Add your phone in Devices to get one.',
  },
};

export const Devices: StoryObj<typeof NotifiedDevices> = {
  render: () => (
    <NotifiedDevices
      devices={[
        { id: '1', name: 'Safari on iPhone', detail: 'Last told 2 hours ago', current: true },
        { id: '2', name: 'Chrome on Mac', detail: 'Not told anything yet' },
        {
          id: '3',
          name: 'Firefox on Windows',
          problem: 'The push service was busy, so the last notification didn’t arrive.',
        },
      ]}
      onRemove={() => undefined}
    />
  ),
};
