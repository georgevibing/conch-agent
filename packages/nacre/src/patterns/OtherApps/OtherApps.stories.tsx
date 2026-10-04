import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../components/Stack';
import {
  McpScopePicker,
  OtherAppTargets,
  PairedAppList,
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
          'Settings → Other apps (ADR 0073): Claude Desktop, Cursor, VS Code and other MCP apps using Conch. The apps Conch connects in one press, what each may use as boxes to tick (nothing is implied), and the paired apps with what they may use, when they last did, and the three things to do about one. State is always said in words.',
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
