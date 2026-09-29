import type { CommandItem } from '@conch/nacre';
import { toast, useCommandMenu, useNacreTheme } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Gauge,
  Moon,
  Plus,
  Settings,
  Shield,
  Repeat,
  SquareSlash,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys, useCommands } from '../../api/queries';
import { useUi } from '../../app/ui';
import { effortLabels, modes } from '../models/catalog';
import type { useTurnOptions } from '../models/useTurnOptions';
import {
  builtins,
  expandCustom,
  parseEffortArg,
  resolveSlash,
  slashQuery,
  type BuiltinAction,
} from './slash';

const builtinIcons: Partial<Record<BuiltinAction, ReactNode>> = {
  model: <Sparkles />,
  effort: <Gauge />,
  fast: <Zap />,
  mode: <Shield />,
  new: <Plus />,
  remember: <Brain />,
  routines: <Repeat />,
  memory: <Brain />,
  commands: <SquareSlash />,
  settings: <Settings />,
  theme: <Moon />,
};

/**
 * Everything behind typing "/": the menu's items, keyboard handling, and what
 * happens when a command is chosen or submitted. Returns `submit`, which
 * reports whether it consumed the text (so the caller doesn't send it).
 */
export function useSlashCommands(options: {
  draft: string;
  setDraft: (value: string) => void;
  send: (text: string) => void;
  turn: ReturnType<typeof useTurnOptions>;
}) {
  const { draft, setDraft, send, turn } = options;
  const [dismissed, setDismissed] = useState(false);
  const { data: custom = [] } = useCommands();
  const engineCommands = turn.capabilities?.commands ?? [];
  const ui = useUi();
  const theme = useNacreTheme();
  const navigate = useNavigate();
  const client = useQueryClient();

  const items: CommandItem[] = [
    ...builtins.map((b) => ({
      id: `conch:${b.name}`,
      name: b.name,
      description: b.description,
      argumentHint: b.argumentHint,
      keywords: b.aliases,
      group: 'Conch',
      icon: builtinIcons[b.action],
    })),
    ...custom.map((c) => ({
      id: `custom:${c.name}`,
      name: c.name,
      description: c.description || c.prompt.slice(0, 80),
      argumentHint: c.prompt.includes('{{input}}') ? 'text' : undefined,
      group: 'Your commands',
    })),
    // Plain commands first; plugin commands ("plugin:skill") after, so /review beats
    // "some-plugin:code-reviews" when both match.
    ...[...engineCommands]
      .sort((a, b) => Number(a.name.includes(':')) - Number(b.name.includes(':')))
      .map((c) => ({
        id: `engine:${c.name}`,
        name: c.name,
        // Plugin skills repeat their plugin name in brackets; the name already says it.
        description: c.description.replace(/^\([^)]*\)\s*/, ''),
        keywords: c.name.includes(':') ? [c.name.split(':').at(-1) ?? c.name] : undefined,
        argumentHint: c.argumentHint || undefined,
        group: 'Claude Code',
      })),
  ];

  const runBuiltin = (action: BuiltinAction, args: string) => {
    const { options: current, model } = turn;
    switch (action) {
      case 'model': {
        if (!args) return ui.setPicker('model');
        const q = args.toLowerCase();
        const match = turn.capabilities?.models.find(
          (m) => m.id.toLowerCase() === q || m.label.toLowerCase().includes(q),
        );
        if (!match) {
          toast(`No model matches “${args}”`, { description: 'Pick one from the list instead.' });
          return ui.setPicker('model');
        }
        turn.set({ model: match.id });
        return toast.success(`Using ${match.label}`);
      }
      case 'effort': {
        const effort = parseEffortArg(args);
        if (!effort) return ui.setPicker('model');
        if (effort !== 'auto' && !model?.efforts.includes(effort as never)) {
          return toast(`${model?.label ?? 'This model'} doesn’t support that level`);
        }
        turn.set({ effort: effort as never });
        return toast.success(
          `Thinking: ${effortLabels[effort as keyof typeof effortLabels].label}`,
        );
      }
      case 'fast':
        if (!model?.supportsFastMode) {
          return toast(`Fast mode isn’t available for ${model?.label ?? 'this model'}`);
        }
        turn.set({ fastMode: !current.fastMode });
        return toast.success(current.fastMode ? 'Fast mode off' : 'Fast mode on');
      case 'mode': {
        if (!args) return ui.setPicker('mode');
        const q = args.toLowerCase();
        const match = modes.find(
          (m) => m.value.toLowerCase() === q || m.label.toLowerCase().includes(q),
        );
        // Full trust always goes through the picker's confirmation.
        if (!match || match.tone === 'danger') return ui.setPicker('mode');
        turn.set({ permissionMode: match.value });
        return toast.success(match.label);
      }
      case 'new':
        return void navigate('/');
      case 'remember':
        if (!args) return setDraft('/remember ');
        return void api.addMemory(args).then((memory) => {
          void client.invalidateQueries({ queryKey: keys.memories });
          toast.success('Remembered', {
            description: memory.content,
            action: {
              label: 'Undo',
              onClick: () =>
                void api
                  .deleteMemory(memory.id)
                  .then(() => client.invalidateQueries({ queryKey: keys.memories })),
            },
          });
        });
      case 'memory':
        return ui.openSettings('memory');
      case 'routines':
        return void navigate('/routines');
      case 'commands':
        return ui.openSettings('commands');
      case 'usage':
        return ui.setUsageOpen(true);
      case 'settings':
        return ui.openSettings();
      case 'theme':
        return theme.setTheme({ mode: theme.resolvedMode === 'dark' ? 'light' : 'dark' });
      case 'help':
        setDismissed(false);
        return setDraft('/');
    }
  };

  /** Handle a submitted message that starts with "/". Returns true if consumed. */
  const submit = (text: string): boolean => {
    const resolved = resolveSlash(text, custom, engineCommands);
    if (!resolved) return false;
    switch (resolved.kind) {
      case 'builtin':
        setDraft('');
        runBuiltin(resolved.builtin.action, resolved.args);
        return true;
      case 'custom':
        send(expandCustom(resolved.command, resolved.args));
        return true;
      case 'engine':
        // Claude Code understands its own slash commands in the prompt.
        send(text.trim());
        return true;
      case 'unknown':
        toast(`There’s no /${resolved.name} command`, {
          description: 'Type / to see what’s available, or create your own in Settings.',
          action: { label: 'Create it', onClick: () => ui.openSettings('commands') },
        });
        return true;
    }
  };

  const menu = useCommandMenu({
    items,
    query: dismissed ? null : slashQuery(draft),
    onSelect: (item) => {
      const needsArgs = Boolean(item.argumentHint) && !['model', 'mode'].includes(item.name);
      if (needsArgs) return setDraft(`/${item.name} `);
      submit(`/${item.name}`);
    },
    onClose: () => setDismissed(true),
  });

  return {
    menu,
    submit,
    onDraftChange: (value: string) => {
      setDismissed(false);
      setDraft(value);
    },
  };
}
