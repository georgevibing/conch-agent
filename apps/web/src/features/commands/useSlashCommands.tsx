import type { PermissionMode, TurnOptions } from '@conch/protocol';
import type { CommandItem, CommandMenuHeading } from '@conch/nacre';
import {
  AgentAvatar,
  SkillIcon,
  toast,
  useCommandMenu,
  useNacreTheme,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AppWindow,
  Brain,
  ClipboardCopy,
  Download,
  Eraser,
  FileText,
  FoldVertical,
  Folder,
  Gauge,
  History,
  KeyRound,
  ListPlus,
  ListTodo,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Settings,
  Shield,
  Repeat,
  SquareSlash,
  Sparkles,
  Stethoscope,
  Sun,
  Target,
  Undo2,
  UserRound,
  WandSparkles,
  Zap,
  CircleHelp,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { findAgent, type Agent } from '@conch/protocol';

import { agentsApi, useAgents } from '../agents/api';
import { api } from '../../api/client';
import { compactChat } from '../chat/compact';
import { keys, useCommands, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import type { ConversationView } from '../../live/reducer';
import { MEMORY_ALL } from '../settings/paths';
import {
  availableModes,
  effortLabels,
  effortOptions,
  modeInfo,
  modelLabel,
} from '../models/catalog';
import { modelKey, type useTurnOptions } from '../models/useTurnOptions';
import { undoLast } from '../undo/UndoHost';
import { COMMANDS_FOCUS } from '../skills/CommandsSection';
import { usableSkills, useSkills } from '../skills/queries';
import { clearChat, setChatGoal } from './context';
import { chatMarkdown, download, exportName, lastReply } from './export';
import {
  INIT_PROMPT,
  builtinFor,
  builtins,
  expandCustom,
  findBuiltin,
  parseEffortArg,
  parseGoalArg,
  parseSwitch,
  parseThemeArg,
  resolveSlash,
  reviewPrompt,
  sectionLabels,
  slashQuery,
  slashValueQuery,
  type Builtin,
  type BuiltinAction,
} from './slash';

const builtinIcons: Partial<Record<BuiltinAction, ReactNode>> = {
  new: <Plus />,
  clear: <Eraser />,
  compact: <FoldVertical />,
  goal: <Target />,
  plan: <ListTodo />,
  retry: <RotateCcw />,
  undo: <Undo2 />,
  task: <ListPlus />,
  rename: <Pencil />,
  copy: <ClipboardCopy />,
  export: <Download />,
  resume: <History />,
  model: <Sparkles />,
  agent: <UserRound />,
  effort: <Gauge />,
  fast: <Zap />,
  mode: <Shield />,
  folder: <Folder />,
  status: <Activity />,
  review: <ScanSearch />,
  init: <FileText />,
  remember: <Brain />,
  routines: <Repeat />,
  skills: <WandSparkles />,
  memory: <Brain />,
  commands: <SquareSlash />,
  apps: <AppWindow />,
  providers: <KeyRound />,
  usage: <Gauge />,
  doctor: <Stethoscope />,
  settings: <Settings />,
  theme: <Moon />,
  help: <CircleHelp />,
};

/** How a message goes out: with a choice for this turn on (plan mode), or a new chat's goal. */
export interface SendHow {
  options?: TurnOptions;
}

/** A command's values, for the menu, and what choosing each does. */
interface Values {
  items: CommandItem[];
  run: Map<string, () => void>;
  heading: CommandMenuHeading;
  empty?: ReactNode;
}

/**
 * Everything behind typing "/": the menu's items (and, after a command with
 * values, its values with the current one marked), keyboard handling, and
 * what happens when a command is chosen or submitted. Conch's own commands
 * work with every provider: what needs the gateway (`/clear`, `/goal`,
 * `/plan`'s approval) is done there; a provider's own command is used only
 * where it does the job better (its own `/compact`, `/review`, `/init`).
 * Returns `submit`, which reports whether it consumed the text.
 */
export function useSlashCommands(options: {
  draft: string;
  setDraft: (value: string) => void;
  send: (text: string, how?: SendHow) => void;
  turn: ReturnType<typeof useTurnOptions>;
  /** The chat this composer belongs to; none yet for a new one. */
  conversationId?: string;
  /** The chat as it's drawn: for `/copy`, `/export`, `/plan off` and `/goal`. */
  view?: ConversationView;
  /** A reply is being written: what changes the chat waits. */
  busy?: boolean;
  /** The chat's title, for `/rename` and `/export`. */
  title?: string;
  /** The assistant's name. */
  name?: string;
  /** Send the last message again. */
  retry?: () => void;
  /** Hand these words off as a background task. */
  background?: (text: string) => void;
  /** Choose the working folder. */
  chooseFolder?: () => void;
}) {
  const {
    draft,
    setDraft,
    send,
    turn,
    conversationId,
    view,
    busy = false,
    title = '',
    name = 'Conch',
  } = options;
  const [dismissed, setDismissed] = useState(false);
  const { data: custom = [] } = useCommands();
  const { data: skillList } = useSkills();
  const skills = usableSkills(skillList);
  const engineCommands = turn.capabilities?.commands ?? [];
  const ui = useUi();
  const draftGoal = useUi((s) => s.draftGoal);
  const theme = useNacreTheme();
  const navigate = useNavigate();
  const client = useQueryClient();
  const goal = conversationId ? view?.goal : (draftGoal ?? undefined);
  const providerLabel = turn.capabilities?.label ?? 'This provider';
  const hasOwn = (command: string) => engineCommands.some((c) => c.name.toLowerCase() === command);
  const modelName = turn.model ? modelLabel(turn.model.label).label : 'This model';

  // Who answers (ADR 0101): this chat's agent, or the one a new chat will start with.
  const { data: agentList } = useAgents();
  const { data: chats } = useConversations();
  const draftAgent = useUi((s) => s.draftAgent);
  const chatAgent = conversationId
    ? chats?.find((c) => c.id === conversationId)?.agentId
    : (draftAgent ?? undefined);
  const currentAgent = agentList
    ? (agentList.agents.find((a) => a.id === chatAgent) ??
      agentList.agents.find((a) => a.id === agentList.defaultId))
    : undefined;
  const chooseAgent = async (agent: Agent) => {
    if (!conversationId) {
      ui.setDraftAgent(agent.isDefault ? null : agent.id);
      return void toast.success(`${agent.name} answers this chat`);
    }
    try {
      await agentsApi.setChatAgent(conversationId, agent.id);
      toast.success(`${agent.name} answers from your next message`);
    } catch (error) {
      toast.error((error as Error).message || 'That didn’t change who answers. Try again.');
    }
  };

  /** Make room in the chat now: `/compact`, and the context meter's Compact now. */
  const compact = async (args?: string) => {
    // A provider that keeps its own memory of the chat (Claude Code, Codex) does its own /compact.
    if (hasOwn('compact')) return send(args ? `/compact ${args}` : '/compact');
    if (!conversationId)
      return void toast('Nothing to summarise yet', {
        description: 'A chat that grows long is summarised by itself.',
      });
    return compactChat(conversationId, args);
  };

  const planModes = turn.capabilities?.permissionModes;
  const canPlan = !planModes?.length || planModes.includes('plan');
  const planning = turn.options.permissionMode === 'plan';
  /** Where `/plan off` goes back to: the mode before plan mode, or your default. */
  const afterPlan = (): PermissionMode => {
    const before = view?.beforePlan ?? turn.defaults.permissionMode;
    return before === 'plan' ? 'default' : before;
  };
  const planOn = () => {
    if (!canPlan) return void toast(`${providerLabel} can’t plan first`);
    turn.set({ permissionMode: 'plan' });
    toast.success('Read only on', {
      description: `${name} looks and plans. Nothing changes until you press Start.`,
    });
  };
  const planOff = () => {
    const back = afterPlan();
    turn.set({ permissionMode: back });
    toast.success('Read only off', { description: modeInfo(back).label });
  };

  const setGoal = async (next: string | null) => {
    if (!conversationId) {
      ui.setDraftGoal(next);
      if (next)
        toast.success('Goal set', { description: 'It goes with your first message in this chat.' });
      else toast('Goal cleared');
      return;
    }
    const ok = await setChatGoal(conversationId, next, goal);
    if (!ok && next) setDraft(`/goal ${next}`);
  };

  const status = () => {
    const parts = [
      `Thinking: ${effortLabels[turn.options.effort].label}`,
      modeInfo(turn.options.permissionMode).label,
      ...(turn.options.fastMode ? ['Fast'] : []),
    ];
    const fill = view?.context;
    if (fill?.window) parts.push(`${Math.round((fill.used / fill.window) * 100)}% of its context`);
    if (goal) parts.push(`Goal: ${goal}`);
    toast(`${providerLabel}${META_SEP}${modelName}`, { description: parts.join(META_SEP) });
  };

  const copy = async () => {
    const text = view && lastReply(view);
    if (!text) return void toast('Nothing to copy yet');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied the last reply');
    } catch {
      toast.error('Couldn’t copy. Select the text and copy it instead.');
    }
  };

  const save = () => {
    if (!view?.items.some((i) => i.kind === 'user')) return void toast('Nothing to save yet');
    const file = exportName(title);
    download(file, chatMarkdown(view, { title: title || 'Chat', name }));
    toast.success('Saved this chat', { description: file });
  };

  const rename = async (to: string) => {
    if (!conversationId)
      return void toast('A new chat is named after its first message', {
        description: 'Rename it after that, with /rename.',
      });
    try {
      await api.renameConversation(conversationId, to.slice(0, 120));
      void client.invalidateQueries({ queryKey: keys.conversations });
      toast.success(`Renamed to “${to.slice(0, 120)}”`);
    } catch (error) {
      toast.error((error as Error).message || 'That didn’t rename it. Try again.');
      setDraft(`/rename ${to}`);
    }
  };

  /** Something that changes the chat, while a reply is being written. */
  const waitFirst = (what: string) => {
    toast(`Wait for this answer to finish, then ${what}`, {
      description: 'Or press Stop first.',
    });
  };

  const runBuiltin = (action: BuiltinAction, args: string) => {
    const { options: current, model } = turn;
    switch (action) {
      case 'agent': {
        const all = agentList?.agents ?? [];
        if (!args)
          return void toast(`${currentAgent?.name ?? name} answers this chat`, {
            description:
              all.length > 1
                ? 'Type /agent and a name to choose another.'
                : 'Make another agent in Settings → Agents.',
          });
        const found = findAgent(all, args);
        if (!found)
          return void toast(`No agent called “${args.slice(0, 40)}”`, {
            description: all.map((a) => a.name).join(', '),
          });
        if (found.id === currentAgent?.id) return void toast(`${found.name} is already answering`);
        return void chooseAgent(found);
      }
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
          return toast(`${modelName} doesn’t support that level`);
        }
        turn.set({ effort: effort as never });
        return toast.success(
          `Thinking: ${effortLabels[effort as keyof typeof effortLabels].label}`,
        );
      }
      case 'fast': {
        if (!model?.supportsFastMode) return toast(`Fast mode isn’t available for ${modelName}`);
        const want = parseSwitch(args) ?? 'toggle';
        const on = want === 'toggle' ? !current.fastMode : want === 'on';
        turn.set({ fastMode: on });
        return toast.success(on ? 'Fast mode on' : 'Fast mode off');
      }
      case 'mode': {
        if (!args) return ui.setPicker('mode');
        const q = args.toLowerCase();
        const match = availableModes(turn.capabilities?.permissionModes).find(
          (m) => m.value.toLowerCase() === q || m.label.toLowerCase().includes(q),
        );
        // Full trust always goes through the picker's confirmation.
        if (!match || match.tone === 'danger') return ui.setPicker('mode');
        turn.set({ permissionMode: match.value });
        return toast.success(match.label);
      }
      case 'plan': {
        const want = parseSwitch(args);
        if (want === 'toggle') return planning ? planOff() : planOn();
        if (want === 'on') return planning ? toast('Already in Read only') : planOn();
        if (want === 'off') return planning ? planOff() : toast('Not in Read only');
        // `/plan <what>`: in plan mode, with this as the message, in one step.
        if (!canPlan) return void toast(`${providerLabel} can’t plan first`);
        return send(args, { options: { permissionMode: 'plan' } });
      }
      case 'goal': {
        const said = parseGoalArg(args);
        if (said.kind === 'clear') {
          if (!goal) return toast('This chat has no goal');
          return void setGoal(null);
        }
        if (said.kind === 'set') return void setGoal(said.goal);
        if (!goal) return setDraft('/goal ');
        return toast(`Goal: ${goal}`, {
          description: 'Kept in mind in every reply.',
          action: { label: 'Change', onClick: () => setDraft(`/goal ${goal}`) },
        });
      }
      case 'new':
        return void navigate('/');
      case 'clear':
        if (!conversationId)
          return toast('Nothing to clear yet', { description: 'A new chat starts fresh.' });
        if (busy) return waitFirst('clear');
        return void clearChat(conversationId, name);
      case 'compact':
        return void compact(args);
      case 'retry':
        if (busy) return waitFirst('send it again');
        if (!view?.items.some((i) => i.kind === 'user')) return toast('Nothing to send again yet');
        return options.retry?.();
      case 'undo':
        return void undoLast();
      case 'task':
        if (!args) return setDraft('/task ');
        return options.background?.(args);
      case 'rename':
        if (!args) return setDraft(`/rename ${title}`.trimEnd() + ' ');
        return void rename(args);
      case 'copy':
        return void copy();
      case 'export':
        return save();
      case 'resume':
        return ui.setPalette(true);
      case 'folder':
        return options.chooseFolder?.();
      case 'status':
        return status();
      case 'review':
        // A provider with its own review (Claude Code, Codex) knows its tools best.
        return send(hasOwn('review') ? `/review ${args}`.trim() : reviewPrompt(args));
      case 'init':
        return send(hasOwn('init') ? '/init' : INIT_PROMPT);
      case 'remember':
        if (!args) return setDraft('/remember ');
        // Said at once; the toast with Undo follows once it's kept.
        toast('Remembering…', { id: 'remember', description: args });
        return void api.addMemory(args).then(
          (memory) => {
            void client.invalidateQueries({ queryKey: keys.memories });
            toast.success('Remembered', {
              id: 'remember',
              description: memory.content,
              action: {
                label: 'Undo',
                onClick: () =>
                  void api
                    .deleteMemory(memory.id)
                    .then(() => client.invalidateQueries({ queryKey: keys.memories })),
              },
            });
          },
          (error: Error) => {
            toast.error(error.message || 'That wasn’t remembered. Try again.', { id: 'remember' });
            setDraft(`/remember ${args}`);
          },
        );
      case 'memory':
        return ui.openSettings('memory', MEMORY_ALL);
      case 'routines':
        return void navigate('/routines');
      case 'skills':
        return void navigate('/skills');
      case 'commands':
        return void navigate('/skills', { state: { focus: COMMANDS_FOCUS } });
      case 'apps':
        return void navigate('/apps');
      case 'providers':
        return ui.openSettings('providers');
      case 'usage':
        return ui.setUsageOpen(true);
      case 'doctor':
        return ui.openSettings('health');
      case 'settings':
        return ui.openSettings();
      case 'theme': {
        const want = parseThemeArg(args);
        return theme.setTheme({
          mode: want === 'toggle' ? (theme.resolvedMode === 'dark' ? 'light' : 'dark') : want,
        });
      }
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
          description: 'Type / to see what’s available, or make your own in Skills.',
          action: {
            label: 'Create it',
            onClick: () => void navigate('/skills', { state: { focus: COMMANDS_FOCUS } }),
          },
        });
        return true;
    }
  };

  // ── The menu: commands, then a command's values ──

  /** Names Conch's own commands already answer to: the provider's of the same name never run. */
  const taken = new Set(builtins.flatMap((b) => [b.name, ...(b.aliases ?? [])]));
  const commandItems: CommandItem[] = [
    // Conch's newer commands give way to yours of the same name.
    ...builtins
      .filter((b) => builtinFor(b.name, custom, skills))
      .map((b) => ({
        id: `conch:${b.name}`,
        name: b.name,
        description: b.description,
        argumentHint: b.argumentHint,
        keywords: b.aliases,
        group: sectionLabels[b.section],
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
    // "some-plugin:code-reviews" when both match. Conch's own (/compact, /review, /init,
    // /clear…) cover the provider's, and hand over to it where it does the job better.
    ...engineCommands
      .filter((c) => !taken.has(c.name.toLowerCase()))
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

  const valuesFor = (builtin: Builtin): Values => {
    const run = new Map<string, () => void>();
    const items: CommandItem[] = [];
    const add = (item: Omit<CommandItem, 'group'> & { group?: string }, act: () => void) => {
      items.push({ group: builtin.name, ...item });
      run.set(item.id, act);
    };
    const heading: CommandMenuHeading = { name: builtin.name, description: builtin.description };
    let empty: ReactNode | undefined;
    switch (builtin.action) {
      case 'agent': {
        for (const agent of agentList?.agents ?? [])
          add(
            {
              id: `agent:${agent.id}`,
              name: agent.name.toLowerCase(),
              title: agent.name,
              ...(agent.role && { description: agent.role }),
              icon: <AgentAvatar name={agent.name} avatar={agent.avatar} size="xs" decorative />,
              current: agent.id === currentAgent?.id,
            },
            () => void chooseAgent(agent),
          );
        empty = 'No agent by that name.';
        break;
      }
      case 'effort': {
        for (const level of effortOptions(turn.model))
          add(
            {
              id: `effort:${level.value}`,
              name: level.value,
              title: level.label,
              description: level.description,
              current: turn.options.effort === level.value,
            },
            () => runBuiltin('effort', level.value),
          );
        empty = turn.model?.efforts.length
          ? 'No thinking level by that name.'
          : `${modelName} has no thinking levels to choose.`;
        break;
      }
      case 'model': {
        const providers = [...(turn.catalog?.providers ?? [])].sort(
          (a, b) =>
            Number(b.engine === turn.options.engine) - Number(a.engine === turn.options.engine),
        );
        for (const provider of providers)
          for (const m of provider.models)
            add(
              {
                id: `model:${modelKey(provider.engine, m.id)}`,
                name: m.id,
                title: modelLabel(m.label).label,
                description: m.description,
                group: provider.label,
                current: provider.engine === turn.options.engine && m.id === turn.options.model,
              },
              () => {
                turn.choose(modelKey(provider.engine, m.id));
                toast.success(`Using ${modelLabel(m.label).label}`, {
                  description: providers.length > 1 ? provider.label : undefined,
                });
              },
            );
        empty = 'No model by that name. Press Enter to look in the picker.';
        break;
      }
      case 'mode':
        for (const mode of availableModes(turn.capabilities?.permissionModes))
          add(
            {
              id: `mode:${mode.value}`,
              name: mode.value,
              title: mode.label,
              description: mode.description,
              icon: mode.icon,
              keywords: [mode.label],
              current: turn.options.permissionMode === mode.value,
            },
            // Full trust always goes through the picker's confirmation.
            () => (mode.tone === 'danger' ? ui.setPicker('mode') : runBuiltin('mode', mode.value)),
          );
        break;
      case 'fast':
        if (turn.model?.supportsFastMode) {
          add(
            {
              id: 'fast:on',
              name: 'on',
              title: 'On',
              description: 'Quicker replies',
              icon: <Zap />,
              current: turn.options.fastMode,
            },
            () => runBuiltin('fast', 'on'),
          );
          add(
            {
              id: 'fast:off',
              name: 'off',
              title: 'Off',
              description: 'The usual pace',
              current: !turn.options.fastMode,
            },
            () => runBuiltin('fast', 'off'),
          );
        }
        empty = `Fast mode isn’t available for ${modelName}.`;
        break;
      case 'theme':
        for (const [mode, label, icon] of [
          ['light', 'Light', <Sun key="sun" />],
          ['dark', 'Dark', <Moon key="moon" />],
          ['system', 'Like this device', <Monitor key="monitor" />],
        ] as const)
          add(
            {
              id: `theme:${mode}`,
              name: mode,
              title: label,
              icon,
              current: theme.mode === mode,
            },
            () => runBuiltin('theme', mode),
          );
        break;
      case 'plan':
        heading.description = planning
          ? `On: ${name} only looks and plans until you press Start`
          : 'Plan first in Read only, or say what to plan';
        if (canPlan) {
          add(
            {
              id: 'plan:on',
              name: 'on',
              title: 'Plan first',
              description: 'Read only: it proposes a plan, nothing changes until you press Start',
              icon: <ListTodo />,
              current: planning,
            },
            () => (planning ? toast('Already in Read only') : planOn()),
          );
          add(
            {
              id: 'plan:off',
              name: 'off',
              title: 'Act as usual',
              description: `Back to ${modeInfo(afterPlan()).label}`,
              current: !planning,
            },
            () => (planning ? planOff() : toast('Not in Read only')),
          );
        }
        empty = canPlan
          ? 'Press Enter to plan this.'
          : `${providerLabel} can’t plan first. Choose another model to plan.`;
        break;
      case 'goal':
        heading.description = goal ? `Now: ${goal}` : 'What this chat is for, in your words';
        if (goal)
          add(
            {
              id: 'goal:clear',
              name: 'clear',
              title: 'Clear the goal',
              description: goal,
              icon: <Eraser />,
            },
            () => void setGoal(null),
          );
        empty = goal
          ? 'Press Enter to make this the goal instead.'
          : 'Write what this chat is for, then press Enter.';
        break;
      default:
        break;
    }
    return { items, run, heading, ...(empty && { empty }) };
  };

  const named = slashQuery(draft);
  const valued = named === null ? slashValueQuery(draft) : null;
  const valueCommand = valued ? builtinFor(valued.name, custom, skills) : undefined;
  const values = valueCommand?.values ? valuesFor(valueCommand) : undefined;

  const menu = useCommandMenu({
    items: values?.items ?? commandItems,
    query: dismissed ? null : values ? (valued?.value ?? '') : named,
    ...(values && {
      label: `${values.heading.name} choices`,
      heading: values.heading,
      onBack: () => {
        setDismissed(false);
        setDraft('/');
      },
      autoActivate: valueCommand?.values === 'choose',
      ...(values.empty !== undefined && { empty: values.empty }),
    }),
    onSelect: (item) => {
      if (values) {
        setDraft('');
        return values.run.get(item.id)?.();
      }
      const builtin = item.id.startsWith('conch:') ? findBuiltin(item.name) : undefined;
      // Typed out in full, a command that only suggests values (/plan, /goal) just runs;
      // otherwise the menu goes on to its values.
      const whole = named?.toLowerCase() === item.name;
      if (builtin?.values === 'suggest' && whole) return void submit(`/${item.name}`);
      if (builtin?.values) return setDraft(`/${builtin.name} `);
      if (builtin?.needsArgs)
        return setDraft(
          builtin.action === 'rename' && title ? `/rename ${title}` : `/${item.name} `,
        );
      if (!builtin && item.argumentHint) return setDraft(`/${item.name} `);
      submit(`/${item.name}`);
    },
    onClose: () => setDismissed(true),
  });

  return {
    menu,
    submit,
    compact,
    /** The chat's goal, or the one waiting to go with a new chat's first message. */
    goal,
    onDraftChange: (value: string) => {
      setDismissed(false);
      setDraft(value);
    },
  };
}
