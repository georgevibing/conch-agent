import type { CommandItem } from '@conch/nacre';
import { SkillIcon, toast, useCommandMenu, useNacreTheme } from '@conch/nacre';
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
  WandSparkles,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { keys, useCommands } from '../../api/queries';
import { useUi } from '../../app/ui';
import { effortLabels, modelLabel, modes } from '../models/catalog';
import { modelKey, type useTurnOptions } from '../models/useTurnOptions';
import { usableSkills, useSkills } from '../skills/queries';
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
  skills: <WandSparkles />,
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
  const { data: skillList } = useSkills();
  const skills = usableSkills(skillList);
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
    ...skills.map((skill) => ({
      id: `skill:${skill.id}`,
      name: skill.name,
      description: skill.description,
      keywords: [skill.title],
      // Anything typed after the name becomes what the skill works on.
      argumentHint: 'details',
      group: 'Skills',
      icon: <SkillIcon name={skill.name} title={skill.title} size="sm" />,
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
        group: turn.capabilities?.label ?? 'Your provider',
      })),
  ];

  const runBuiltin = (action: BuiltinAction, args: string) => {
    const { options: current, model } = turn;
    switch (action) {
      case 'model': {
        if (!args) return ui.setPicker('model');
        const q = args.toLowerCase();
        // Every connected provider's models; the current provider's first.
        const providers = [...(turn.catalog?.providers ?? [])].sort(
          (a, b) =>
            Number(b.engine === turn.options.engine) - Number(a.engine === turn.options.engine),
        );
        const all = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
        const match =
          all.find(({ model: m }) => m.id.toLowerCase() === q) ??
          all.find(({ model: m }) => m.label.toLowerCase().includes(q));
        if (!match) {
          toast(`No model matches “${args}”`, { description: 'Pick one from the list instead.' });
          return ui.setPicker('model');
        }
        turn.choose(modelKey(match.provider.engine, match.model.id));
        return toast.success(`Using ${modelLabel(match.model.label).label}`, {
          description: providers.length > 1 ? match.provider.label : undefined,
        });
      }
      case 'effort': {
        const effort = parseEffortArg(args);
        if (!effort) return ui.setPicker('model');
        if (effort !== 'auto' && !model?.efforts.includes(effort as never)) {
          return toast(
            `${model ? modelLabel(model.label).label : 'This model'} doesn’t support that level`,
          );
        }
        turn.set({ effort: effort as never });
        return toast.success(
          `Thinking: ${effortLabels[effort as keyof typeof effortLabels].label}`,
        );
      }
      case 'fast':
        if (!model?.supportsFastMode) {
          return toast(
            `Fast mode isn’t available for ${model ? modelLabel(model.label).label : 'this model'}`,
          );
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
        return void navigate('/memory');
      case 'routines':
        return void navigate('/routines');
      case 'skills':
        return void navigate('/skills');
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
    const resolved = resolveSlash(text, custom, engineCommands, skills);
    if (!resolved) return false;
    switch (resolved.kind) {
      case 'builtin':
        setDraft('');
        runBuiltin(resolved.builtin.action, resolved.args);
        return true;
      case 'custom':
        send(expandCustom(resolved.command, resolved.args));
        return true;
      case 'skill':
        // The gateway expands it into the skill's instructions, for any provider.
        send(text.trim());
        return true;
      case 'engine':
        // The provider understands its own slash commands in the prompt.
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
