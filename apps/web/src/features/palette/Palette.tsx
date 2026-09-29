import { CommandPalette, useNacreTheme } from '@conch/nacre';
import { Brain, MessageSquare, Moon, PanelLeft, Settings, SquarePen, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';

/** ⌘K: everything in Conch is two keystrokes away. */
export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const openSettings = useUi((s) => s.openSettings);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const theme = useNacreTheme();
  const navigate = useNavigate();
  const { data: conversations } = useConversations();

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      placeholder="Search conversations and commands…"
    >
      <CommandPalette.Group heading="Actions">
        <CommandPalette.Item
          icon={<SquarePen />}
          shortcut="mod+shift+o"
          onSelect={run(() => void navigate('/'))}
        >
          New chat
        </CommandPalette.Item>
        <CommandPalette.Item
          icon={<Settings />}
          shortcut="mod+,"
          onSelect={run(() => openSettings())}
        >
          Settings
        </CommandPalette.Item>
        <CommandPalette.Item icon={<Brain />} onSelect={run(() => openSettings('memory'))}>
          What do you remember about me?
        </CommandPalette.Item>
        <CommandPalette.Item
          icon={theme.resolvedMode === 'dark' ? <Sun /> : <Moon />}
          onSelect={run(() =>
            theme.setTheme({ mode: theme.resolvedMode === 'dark' ? 'light' : 'dark' }),
          )}
        >
          {theme.resolvedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        </CommandPalette.Item>
        <CommandPalette.Item icon={<PanelLeft />} shortcut="mod+b" onSelect={run(toggleSidebar)}>
          Toggle sidebar
        </CommandPalette.Item>
      </CommandPalette.Group>
      {Boolean(conversations?.length) && (
        <CommandPalette.Group heading="Conversations">
          {conversations?.slice(0, 30).map((c) => (
            <CommandPalette.Item
              key={c.id}
              value={`${c.title} ${c.id}`}
              icon={<MessageSquare />}
              onSelect={run(() => void navigate(`/c/${c.id}`))}
            >
              {c.title}
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      )}
    </CommandPalette>
  );
}
