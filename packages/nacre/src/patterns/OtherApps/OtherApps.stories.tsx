import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Stack } from '../../components/Stack';
import {
  McpScopePicker,
  OtherAppsArt,
  OtherAppTargets,
  PairedAppList,
  PairedAppListSkeleton,
  type McpScopeChoice,
  type OtherAppTarget,
  type PairedAppItem,
} from './OtherApps';

const targets: OtherAppTarget[] = [
  {
    app: 'claude-desktop',
    name: 'Claude Desktop',
    brand: 'anthropic-api',
    color: '#d97757',
    state: 'connected',
    detail: 'Your memory, Gmail and the browser',
  },
  { app: 'cursor', name: 'Cursor', color: '#1e1e1e', state: 'ready' },
  { app: 'vscode', name: 'VS Code', color: '#007acc', state: 'missing' },
];

const choices: McpScopeChoice[] = [
  {
    scope: 'memory.read',
    kind: 'conch',
    title: 'Search what Conch knows about you',
    detail: 'Your memories, found by meaning.',
  },
  {
    scope: 'memory.write',
    kind: 'conch',
    title: 'Suggest things to remember',
    detail: 'Each one waits for your OK in What Conch knows.',
  },
  {
    scope: 'skills',
    kind: 'conch',
    title: 'Use your skills',
    detail: 'Read the instructions you saved. It follows them itself.',
  },
  {
    scope: 'browser',
    kind: 'conch',
    title: 'Use Conch’s browser',
    detail: 'In a tab of its own. It asks you before each new site, as Conch does.',
  },
  { scope: 'app:gmail', kind: 'app', title: 'Gmail', brand: 'gmail' },
  { scope: 'app:notion', kind: 'app', title: 'Notion', brand: 'notion' },
];

const paired: PairedAppItem[] = [
  {
    id: 'a',
    name: 'Claude Desktop',
    brand: 'anthropic-api',
    color: '#d97757',
    uses: 'Your memory, Gmail and the browser',
    meta: 'Paired 3 Oct · used 2 minutes ago',
  },
  {
    id: 'b',
    name: 'My laptop’s editor',
    uses: 'Your skills',
    meta: 'Paired 1 Oct · never used',
    remote: true,
  },
];

const meta = {
  title: 'Patterns/OtherApps',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Access → Apps that use Conch (ADR 0073): Claude Desktop, Cursor, VS Code and other MCP apps using Conch. The apps Conch connects in one press, what each may use as boxes to tick (nothing is implied), and the paired apps with what they may use, when they last did, and the three things to do about one. State is always said in words.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Targets: Story = {
  render: () => (
    <OtherAppTargets targets={targets} onConnect={() => undefined} onManage={() => undefined} />
  ),
};

export const WhatItMayUse: Story = {
  render: function Render() {
    const [value, setValue] = useState<string[]>(['memory.read', 'app:gmail']);
    return <McpScopePicker choices={choices} value={value} onChange={setValue} />;
  },
};

export const NoAppsYet: Story = {
  render: () => (
    <McpScopePicker
      choices={choices.filter((c) => c.kind === 'conch')}
      value={['memory.read']}
      onChange={() => undefined}
    />
  ),
};

export const Paired: Story = {
  render: () => (
    <PairedAppList
      apps={paired}
      onOpen={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />
  ),
};

export const NothingPaired: Story = {
  render: () => <PairedAppList apps={[]} />,
};

/** While the paired list loads: the same rows at the same height, so nothing moves when it lands. */
export const Loading: Story = {
  render: () => (
    <div aria-busy="true">
      <PairedAppListSkeleton rows={2} />
    </div>
  ),
};

/** Loading and loaded, side by side: each row lines up with its placeholder. */
export const LoadingBesideLoaded: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <PairedAppListSkeleton rows={2} />
      <PairedAppList apps={paired} onEdit={() => undefined} onRemove={() => undefined} />
    </div>
  ),
};

/** The picture on its own: any app, or the ones on this computer. */
export const Art: Story = {
  render: () => (
    <Stack gap={6}>
      <OtherAppsArt />
      <OtherAppsArt apps={targets.map((t) => ({ name: t.name, brand: t.brand, color: t.color }))} />
    </Stack>
  ),
};

/** Nothing paired yet: a calm splash, one sentence and one button. */
export const NothingPairedYet: Story = {
  render: () => (
    <EmptyState
      size="sm"
      headingLevel={4}
      media={<OtherAppsArt />}
      title="Nothing paired yet"
      description="Pair an app, and it can use what you choose. It asks you before it changes anything."
      actions={<Button leadingIcon={<Plus />}>Pair an app</Button>}
    />
  ),
};

export const TheWholePlace: Story = {
  render: function Render() {
    const [value, setValue] = useState<string[]>(['memory.read']);
    return (
      <Stack gap={6}>
        <OtherAppTargets targets={targets} onConnect={() => undefined} onManage={() => undefined} />
        <McpScopePicker choices={choices} value={value} onChange={setValue} />
        <PairedAppList
          apps={paired}
          busy="b"
          onOpen={() => undefined}
          onEdit={() => undefined}
          onRemove={() => undefined}
        />
      </Stack>
    );
  },
};
