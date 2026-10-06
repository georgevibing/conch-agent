/* Story/test fixtures — not exported from the package. */
import {
  Brain,
  Cpu,
  FilePlus2,
  Gauge,
  MessageSquarePlus,
  Minimize2,
  Palette,
  Settings,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

import { useState, type ReactNode } from 'react';

import { Composer } from '../Composer';
import { CommandMenu, useCommandMenu, type CommandItem } from './CommandMenu';

export const commands: CommandItem[] = [
  { id: 'model', name: 'model', description: 'Choose the model', group: 'Conch', icon: <Cpu /> },
  {
    id: 'effort',
    name: 'effort',
    argumentHint: '[auto|low|high|max]',
    description: 'How hard the model thinks',
    group: 'Conch',
    icon: <Gauge />,
    keywords: ['thinking'],
  },
  { id: 'fast', name: 'fast', description: 'Toggle fast mode', group: 'Conch', icon: <Zap /> },
  {
    id: 'mode',
    name: 'mode',
    description: 'Ask first, auto, plan or full trust',
    group: 'Conch',
    icon: <ShieldCheck />,
    keywords: ['permissions', 'trust'],
  },
  {
    id: 'new',
    name: 'new',
    description: 'Start a new chat',
    group: 'Conch',
    icon: <MessageSquarePlus />,
    keywords: ['clear'],
  },
  {
    id: 'remember',
    name: 'remember',
    argumentHint: '<something about you>',
    description: 'Save a memory',
    group: 'Conch',
    icon: <Brain />,
  },
  {
    id: 'theme',
    name: 'theme',
    description: 'Switch light and dark',
    group: 'Conch',
    icon: <Palette />,
  },
  {
    id: 'settings',
    name: 'settings',
    description: 'Open settings',
    group: 'Conch',
    icon: <Settings />,
  },
  {
    id: 'standup',
    name: 'standup',
    description: 'Summarise what changed since yesterday',
    group: 'Your commands',
    icon: <Sparkles />,
  },
  {
    id: 'pr',
    name: 'pr',
    argumentHint: '[branch]',
    description: 'Write a pull request description',
    group: 'Your commands',
    icon: <FilePlus2 />,
  },
  {
    id: 'compact',
    name: 'compact',
    argumentHint: '[instructions]',
    description: 'Summarise the conversation to free up context',
    group: 'Claude Code',
    icon: <Minimize2 />,
  },
  { id: 'review', name: 'review', description: 'Review the current changes', group: 'Claude Code' },
  {
    id: 'init',
    name: 'init',
    description: 'Create a CLAUDE.md for this project',
    group: 'Claude Code',
  },
];

/** `/effort`'s values: what the menu offers once the command is chosen. */
export const efforts: CommandItem[] = [
  { id: 'auto', name: 'auto', title: 'Auto', description: 'The model decides how long to think' },
  { id: 'low', name: 'low', title: 'Low', description: 'Quick answers for simple things' },
  { id: 'medium', name: 'medium', title: 'Medium', description: 'A balance of speed and care' },
  {
    id: 'high',
    name: 'high',
    title: 'High',
    description: 'Careful thinking for real work',
    current: true,
  },
  { id: 'max', name: 'max', title: 'Max', description: 'As much thinking as it takes' },
].map((item) => ({ ...item, group: 'Thinking' }));

/** `/model`'s values, from two providers: a name to read, an id to type. */
export const models: CommandItem[] = [
  {
    id: 'cc|opus',
    name: 'opus',
    title: 'Opus 4.6',
    description: 'Most capable',
    group: 'Claude Code',
    current: true,
  },
  {
    id: 'cc|sonnet',
    name: 'sonnet',
    title: 'Sonnet 4.6',
    description: 'Fast and smart',
    group: 'Claude Code',
  },
  {
    id: 'or|gpt',
    name: 'openai/gpt-5.1',
    title: 'GPT-5.1',
    description: 'OpenAI',
    group: 'OpenRouter',
  },
  {
    id: 'or|gemini',
    name: 'google/gemini-3-pro',
    title: 'Gemini 3 Pro',
    description: 'Google',
    group: 'OpenRouter',
  },
];

/**
 * The wiring an app does, in two steps: "/" at the start of the draft opens
 * the commands; choosing one with values (`/effort`, `/model`) goes on to
 * them, the current one marked; choosing a value acts.
 */
export function SlashComposer({
  initial = '',
  onAction,
  onSubmit,
  toolbar,
}: {
  initial?: string;
  onAction?: (action: string) => void;
  onSubmit?: (value: string) => void;
  toolbar?: ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [dismissed, setDismissed] = useState(false);
  const named = /^\/(\S*)$/.exec(value);
  const valued = /^\/(effort|model) (\S*)$/.exec(value);
  const command = valued?.[1];
  const values = command === 'effort' ? efforts : command === 'model' ? models : undefined;
  const heading = commands.find((c) => c.name === command);
  const menu = useCommandMenu({
    items: values ?? commands,
    query: dismissed ? null : values ? (valued?.[2] ?? '') : named ? (named[1] ?? '') : null,
    label: values ? `${heading?.name ?? ''} values` : 'Commands',
    ...(values &&
      heading && {
        heading: {
          name: heading.name,
          ...(heading.description && { description: heading.description }),
        },
        onBack: () => setValue('/'),
      }),
    ...(values && { empty: 'Nothing like that. Press Enter to try it anyway.' }),
    onSelect: (item) => {
      if (values) {
        onAction?.(`/${command} ${item.name}`);
        return setValue('');
      }
      if (item.name === 'effort' || item.name === 'model') return setValue(`/${item.name} `);
      onAction?.(`/${item.name}`);
      setValue(item.argumentHint ? `/${item.name} ` : '');
    },
    onClose: () => setDismissed(true),
  });
  return (
    <Composer
      label="Message"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        setDismissed(false);
      }}
      onSubmit={(v) => {
        onSubmit?.(v);
        setValue('');
      }}
      placeholder="Message Conch, or type / for commands"
      toolbar={toolbar}
      onTextareaKeyDown={(e) => {
        menu.onKeyDown(e);
      }}
      textareaProps={menu.inputProps}
      overlay={<CommandMenu {...menu.menuProps} />}
    />
  );
}
