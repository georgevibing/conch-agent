import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  FileCode2,
  FolderOpen,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  Palette,
  PanelLeft,
  Settings2,
  Square,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useNacreTheme } from '../../theme';
import { Button } from '../Button';
import { Kbd } from '../Kbd';
import { Stack } from '../Stack';
import { Text } from '../Text';
import { CommandPalette } from './CommandPalette';

const meta = {
  title: 'Components/Overlays/CommandPalette',
  parameters: {
    docs: {
      description: {
        component:
          'The ⌘K palette. Built on cmdk inside a Nacre dialog: fuzzy search, grouped results, a gliding selection wash and a list that springs to its new height as results filter.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PaletteDemo({ defaultOpen }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { resolvedMode, setTheme } = useNacreTheme();
  return (
    <Stack align="center" gap={3}>
      <Button
        variant="surface"
        onClick={() => setOpen(true)}
        trailingIcon={<Kbd keys="mod+k" size="sm" />}
      >
        Search or run a command
      </Button>
      <Text size="xs" tone="subtle">
        Or press <Kbd keys="mod+k" size="sm" /> anywhere
      </Text>
      <CommandPalette open={open} onOpenChange={setOpen}>
        <CommandPalette.Group heading="Actions">
          <CommandPalette.Item
            icon={<MessageSquarePlus />}
            shortcut="mod+n"
            onSelect={() => setOpen(false)}
          >
            New session
          </CommandPalette.Item>
          <CommandPalette.Item icon={<Square />} shortcut="esc">
            Stop generating
          </CommandPalette.Item>
          <CommandPalette.Item icon={<PanelLeft />} shortcut="mod+b">
            Toggle sidebar
          </CommandPalette.Item>
        </CommandPalette.Group>
        <CommandPalette.Group heading="Recent sessions">
          <CommandPalette.Item icon={<MessageSquare />} hint="2m ago">
            Refactor auth flow
          </CommandPalette.Item>
          <CommandPalette.Item icon={<MessageSquare />} hint="1h ago">
            Fix flaky websocket test
          </CommandPalette.Item>
          <CommandPalette.Item icon={<MessageSquare />} hint="Yesterday">
            Design token audit
          </CommandPalette.Item>
        </CommandPalette.Group>
        <CommandPalette.Group heading="Files">
          <CommandPalette.Item icon={<FileCode2 />} hint="src/auth">
            session.ts
          </CommandPalette.Item>
          <CommandPalette.Item icon={<FolderOpen />} hint="~/projects">
            Open project…
          </CommandPalette.Item>
        </CommandPalette.Group>
        <CommandPalette.Group heading="Preferences">
          <CommandPalette.Item
            icon={<Moon />}
            keywords={['theme', 'dark', 'light', 'appearance']}
            onSelect={() => setTheme({ mode: resolvedMode === 'dark' ? 'light' : 'dark' })}
          >
            Toggle dark mode
          </CommandPalette.Item>
          <CommandPalette.Item icon={<Palette />} keywords={['accent', 'colour', 'color']}>
            Change accent colour
          </CommandPalette.Item>
          <CommandPalette.Item icon={<Settings2 />} shortcut="mod+,">
            Settings
          </CommandPalette.Item>
        </CommandPalette.Group>
      </CommandPalette>
    </Stack>
  );
}

export const Default: Story = {
  render: () => <PaletteDemo />,
};

export const Open: Story = {
  tags: ['!autodocs'],
  render: () => <PaletteDemo defaultOpen />,
};

function AsyncSearch() {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  useEffect(() => {
    if (!search) return;
    const start = setTimeout(() => setLoading(true), 0);
    const t = setTimeout(() => {
      setResults(['session.ts', 'session.test.ts', 'useSession.ts'].map((f) => `${search} · ${f}`));
      setLoading(false);
    }, 700);
    return () => {
      clearTimeout(start);
      clearTimeout(t);
    };
  }, [search]);
  return (
    <CommandPalette
      defaultOpen
      hotkey={null}
      shouldFilter={false}
      search={search}
      onSearchChange={setSearch}
      loading={loading}
      placeholder="Search files on the host…"
      empty={search ? 'No matching files.' : 'Start typing to search the host.'}
    >
      {!loading && search && (
        <CommandPalette.Group heading="Files">
          {results.map((r) => (
            <CommandPalette.Item key={r} value={r} icon={<FileCode2 />}>
              {r}
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      )}
    </CommandPalette>
  );
}

export const AsyncResults: Story = {
  tags: ['!autodocs'],
  render: () => <AsyncSearch />,
};
