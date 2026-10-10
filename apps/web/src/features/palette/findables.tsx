import {
  foldText,
  fuzzyFilter,
  type FuzzyMatch,
  canUseApps,
  generatePassword,
  type TaskList,
  type TextRange,
  chatAgentId,
  type Agent,
} from '@conch/protocol';
import {
  AgentAvatar,
  AppIcon,
  FolderMark,
  useMediaQuery,
  type AppIconLook,
  ARTIFACT_KINDS,
  CHAT_ONLY_WORDS,
  IntegrationLogo,
  vaultSourceColor,
  ProviderLogo,
  SkillIcon,
  toast,
  VaultKindGlyph,
  META_SEP,
} from '@conch/nacre';
import {
  Box,
  Cable,
  UserRoundPlus,
  UsersRound,
  Archive,
  ArchiveRestore,
  CirclePause,
  BadgeCheck,
  BatteryMedium,
  Coins,
  Folder,
  FolderMinus,
  FolderPlus,
  Pin,
  PinOff,
  Settings2,
  Bell,
  Blocks,
  Brain,
  ChartLine,
  CircleArrowUp,
  Cpu,
  Download,
  Gauge,
  MessagesSquare,
  MonitorSmartphone,
  Smartphone,
  Globe,
  HeartPulse,
  Laptop,
  MousePointerClick,
  ListChecks,
  ListPlus,
  Play,
  History,
  KeyRound,
  Palette as PaletteIcon,
  Paperclip,
  Pencil,
  SquareTerminal,
  Plus,
  Mic,
  Power,
  QrCode,
  RefreshCw,
  Repeat,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  CircleOff,
  Undo2,
  Upload,
  SquareSlash,
  User,
  WandSparkles,
  Timer,
  Wallet,
  WifiOff,
  Wrench,
  House,
  Zap,
  FingerprintPattern,
  GlobeLock,
  Compass,
  Sunrise,
  Lightbulb,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useConversations, useFolders } from '../../api/queries';
import { useUi, type SettingsTab } from '../../app/ui';
import { NARROW } from '../../app/widths';
import { MEMORY_ALL, OTHER_APPS_FOCUS } from '../settings/paths';
import { ARCHIVE_PATH, isChat, useArchive } from '../archive/useArchive';
import { useOrganise } from '../chatlist/useOrganise';
import { COME_HOME_FOCUS } from '../import/api';
import { PAST_CHATS_FOCUS } from '../import/pastChats';
import { doctorApi } from '../health/api';
import { LIVE_DATA_FOCUS } from '../artifacts/LiveDataSection';
import { WORKPLACES_FOCUS } from '../workplaces/words';
import {
  ADD_DEVICE_FOCUS,
  ADDRESS_FOCUS,
  DEVICES_FOCUS,
  KEYS_FOCUS,
  PASSKEYS_FOCUS,
  REACH_FOCUS,
  SIGN_IN_FOCUS,
} from '../auth/focus';
import { FALLBACK_FOCUS } from '../settings/FallbackSection';
import { ADVANCED_FOCUS } from '../settings/useAdvanced';
import { HEALED_FOCUS } from '../settings/HealedSection';
import { PLAN_ROOM_FOCUS, ROUTINES_SPEND_FOCUS } from '../routines/SpendingSection';
import { LEARNING_SPEND_FOCUS } from '../learning/LearningSpendSection';
import { NEVER_INTENT } from '../learning/LearningSections';
import { useQuietChat } from '../learning/useQuietChat';
import { TURN_LIMITS_FOCUS } from '../usage/TurnLimitsSection';
import { APP_WORDS, APPS } from '../channels/describe';
import { useChannels } from '../channels/queries';
import { isManager } from '../integrations/apps';
import { useIntegrations } from '../integrations/queries';
import { TELL_FOCUS } from '../memory/AboutYou';
import { downloadMemories } from '../memory/api';
import { OWN_WORDS_FOCUS } from '../memory/MemoryTab';
import { copySecret } from '../passwords/clipboard';
import { useVault } from '../passwords/queries';
import { modelLabel, providerLogo } from '../models/catalog';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { useArtifacts } from '../artifacts/queries';
import { useConchApps } from '../conchapps/queries';
import { appLook, conchPagePath } from '../conchapps/words';
import { useRoutines } from '../routines/queries';
import { going, taskKeys } from '../tasks/queries';
import { tasksApi } from '../tasks/api';
import { ApiError } from '../../api/client';
import { COMMANDS_FOCUS } from '../skills/CommandsSection';
import { listingPath } from '../skills/Discover';
import { useMarket } from '../skills/market';
import { useSkills, useWorkSuggestions } from '../skills/queries';
import { useDebounced } from '../channels/hooks';
import { draftFrom } from '../skills/SkillSuggestions';
import { useLiveStore } from '../../live/store';
import { useTerminalStatus } from '../terminal/queries';
import { undoLast } from '../undo/UndoHost';
import { useUpdates } from '../updates/queries';
import { BACKGROUND_FOCUS } from '../background/AlwaysOnSection';
import { agentsApi, useAgents } from '../agents/api';

/** Something ⌘K can find and act on that isn't a chat or a message. */
export interface Findable {
  id: string;
  label: string;
  /** Where the match is marked in the label. */
  ranges?: TextRange[];
  description?: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export interface FindableGroup {
  heading: string;
  items: Findable[];
}

const settingsPlaces: {
  tab: SettingsTab;
  /** A place inside the tab (see `openSettings`). */
  focus?: string;
  label: string;
  keywords: string;
  icon: ReactNode;
}[] = [
  {
    tab: 'general',
    label: 'General',
    keywords: 'general settings',
    icon: <Settings2 />,
  },
  {
    tab: 'general',
    label: 'Start over',
    keywords: 'start over replay welcome onboarding setup again first run',
    icon: <RefreshCw />,
  },
  {
    // Appearance is part of General now: its old name still finds it.
    tab: 'general',
    label: 'Appearance',
    keywords: 'appearance theme dark light mode colour color accent reduce motion animation',
    icon: <PaletteIcon />,
  },
  {
    // Lustre was its old name.
    tab: 'general',
    label: 'Shimmer',
    keywords: 'shimmer lustre pearl sheen iridescence shine effects',
    icon: <Sparkles />,
  },
  {
    tab: 'general',
    label: 'Name new chats automatically',
    keywords: 'name new chats automatically title titles auto rename chat names',
    icon: <Pencil />,
  },
  {
    tab: 'general',
    label: 'Offers in the chat',
    keywords: 'offers suggestions suggest again muted don’t suggest dont apps skills',
    icon: <Blocks />,
  },
  {
    tab: 'general',
    label: 'Tips on a new chat',
    keywords: 'tips hints show tips again put away hidden dismissed new chat bring back',
    icon: <Lightbulb />,
  },
  {
    tab: 'general',
    label: 'Working folder',
    keywords: 'working folder workspace directory project files where cwd',
    icon: <Folder />,
  },
  {
    tab: 'agents',
    label: 'Agents',
    keywords: 'agents assistants personality persona name face avatar tone voice instructions',
    icon: <UsersRound />,
  },
  // Agents that talk to each other (ADR 0112).
  {
    tab: 'agents',
    label: 'Outside agents',
    keywords: 'outside agents a2a agent2agent other agent add paste address remote peer talk',
    icon: <UsersRound />,
  },
  {
    tab: 'agents',
    label: 'Let another agent in',
    keywords: 'let agent in a2a share my agent pair peer another agent talk to my agent key',
    icon: <UsersRound />,
  },
  // About you and Memory are one place now, What Conch knows: either name finds it.
  {
    tab: 'memory',
    label: 'What Conch knows',
    keywords: 'what conch knows memory memories remember forget about you profile me',
    icon: <Brain />,
  },
  { tab: 'memory', label: 'About you', keywords: 'about you profile me', icon: <User /> },
  { tab: 'memory', label: 'Memory', keywords: 'remember forget', icon: <Brain /> },
  {
    tab: 'memory',
    focus: TELL_FOCUS,
    label: 'Tell Conch something about you',
    keywords:
      'about me profile portrait what conch knows remember my name people family preferences how i like answers where i live work interests',
    icon: <User />,
  },
  {
    tab: 'memory',
    focus: OWN_WORDS_FOCUS,
    label: 'In your own words',
    keywords: 'about me bio describe myself profile write',
    icon: <User />,
  },
  {
    tab: 'memory',
    focus: ADVANCED_FOCUS,
    label: 'What every chat starts with',
    keywords: 'system prompt about the user profile what it reads first instructions',
    icon: <User />,
  },
  {
    tab: 'providers',
    focus: FALLBACK_FOCUS,
    label: 'When one can’t answer',
    keywords:
      'when a provider can’t answer cant offline internet wifi usage limit reached at a limit fallback continue switch local model ollama wait answer offline automatic next plan key with room order carry on switch back',
    icon: <WifiOff />,
  },
  { tab: 'usage', label: 'Usage', keywords: 'limits spend budget plan', icon: <BatteryMedium /> },
  {
    // Usage → Limits, a page of its own.
    tab: 'usage',
    focus: 'limits',
    label: 'Usage limits',
    keywords: 'limits limit cap long turns routines learning spend steps tokens minutes',
    icon: <Gauge />,
  },
  {
    tab: 'usage',
    focus: ROUTINES_SPEND_FOCUS,
    label: 'What routines may spend',
    keywords:
      'routines routine spending spend limit monthly month cost costs money bill budget cap paused pause raise unattended',
    icon: <Wallet />,
  },
  {
    tab: 'usage',
    focus: LEARNING_SPEND_FOCUS,
    label: 'What learning may spend',
    keywords:
      'learning learn spending spend limit monthly month cost costs money budget cap paused memory memories quiet',
    icon: <Wallet />,
  },
  {
    tab: 'usage',
    focus: PLAN_ROOM_FOCUS,
    label: 'When routines wait for your plan',
    keywords:
      'room for your own chats routines routine wait waiting plan subscription nearly used full threshold percent always run never wait skip skipped',
    icon: <Gauge />,
  },
  {
    tab: 'usage',
    focus: TURN_LIMITS_FOCUS,
    label: 'Pause long turns',
    keywords:
      'long turns pause paused check in carry on steps tokens minutes limit stop runs on power user',
    icon: <Timer />,
  },
  {
    tab: 'computer',
    label: 'This computer',
    keywords:
      'this computer machine system cpu processor cores memory ram disk storage space free network download upload gpu graphics battery temperature load uptime activity monitor task manager performance resources busy slow processes',
    icon: <Laptop />,
  },
  {
    // The assistant using this computer's apps (ADR 0110): its switch is on This computer.
    tab: 'computer',
    label: 'Use your apps',
    keywords:
      'use my apps computer use control my computer mac desktop apps click type keyboard mouse screen screenshot screen recording accessibility automate keynote notes finder glowing edge stop',
    icon: <MousePointerClick />,
  },
  {
    // Dashboards (ADR 0121): Conch's numbers for Grafana, Prometheus and the rest.
    tab: 'dashboards',
    label: 'Dashboards',
    keywords:
      'dashboards grafana prometheus metrics scrape opentelemetry otel otlp telemetry observability monitoring traces spans honeycomb datadog new relic langfuse phoenix arize collector export send numbers',
    icon: <ChartLine />,
  },
  {
    tab: 'health',
    label: 'Health',
    keywords:
      'repair everything fix doctor checkup broken updates update upgrade backup back up restore fixed healed',
    icon: <HeartPulse />,
  },
  {
    // Every part's repairs (the terminal's and the browser's too) are listed here, and only here.
    tab: 'health',
    focus: HEALED_FOCUS,
    label: 'Fixed on its own',
    keywords:
      'fixed on its own healed self repaired repairs what conch fixed reassurance terminal browser restarted reset recovered',
    icon: <Sparkles />,
  },
  {
    tab: 'health',
    focus: BACKGROUND_FOCUS,
    label: 'Menu bar',
    keywords: 'menu bar tray icon system tray status bar panel indicator taskbar',
    icon: <Power />,
  },
  {
    tab: 'notifications',
    label: 'Notifications',
    keywords:
      'notifications notify allow push alerts phone bell badge lock screen tell me when it needs you approval an answer is ready reply a routine runs a task finishes a device asks to sign in there’s a new version update show what it’s about preview details quiet send a test',
    icon: <Bell />,
  },
  {
    // Notifications → Topics, a page of its own.
    tab: 'notifications',
    focus: 'topics',
    label: 'What notifications are about',
    keywords:
      'notification topics tell me when it needs you approval an answer is ready reply a routine runs a task finishes a device asks to sign in there’s a new version',
    icon: <Bell />,
  },
  {
    tab: 'voice',
    label: 'Voice',
    keywords:
      'voice dictation dictate speak talk microphone mic speech read aloud language accent tts stt natural voices piper hey conch wake word voice notes',
    icon: <Mic />,
  },
  {
    tab: 'voice',
    label: 'Where your voice is heard',
    keywords:
      'private on this computer whisper browser speech service google apple hears reading speed rate',
    icon: <Mic />,
  },
  {
    tab: 'access',
    focus: ADD_DEVICE_FOCUS,
    label: 'Add your phone',
    keywords:
      'add phone device iphone android tablet qr code pair tailscale secure address mobile home screen',
    icon: <QrCode />,
  },
  {
    tab: 'health',
    focus: BACKGROUND_FOCUS,
    label: 'Always on',
    keywords:
      'always on background start at login startup login items launch boot keep running daemon service close window server headless log out logout awake sleep caffeinate little computer mac mini raspberry pi',
    icon: <Power />,
  },
  {
    tab: 'security',
    label: 'Security',
    keywords: 'security checkup safe safety',
    icon: <ShieldCheck />,
  },
  {
    tab: 'access',
    label: 'Access',
    keywords: 'access sign in signing in log in login password devices other apps who gets in',
    icon: <KeyRound />,
  },
  {
    tab: 'access',
    focus: SIGN_IN_FOCUS,
    label: 'How you sign in',
    keywords: 'how you sign in password change password sign-in method no sign-in turn off',
    icon: <KeyRound />,
  },
  {
    tab: 'access',
    focus: KEYS_FOCUS,
    label: 'Access keys',
    keywords: 'access keys key token new key scripts api',
    icon: <KeyRound />,
  },
  {
    tab: 'security',
    focus: WORKPLACES_FOCUS,
    label: 'Where work runs',
    keywords:
      'where work runs commands run container docker podman sandbox isolated box ssh remote machine server another computer cloud daytona vm devbox',
    icon: <Box />,
  },
  {
    tab: 'security',
    focus: LIVE_DATA_FOCUS,
    label: 'Live data in pages',
    keywords:
      'live data pages apps sites fetch fresh numbers weather prices api allowed allow revoke take back read from network',
    icon: <Globe />,
  },
  {
    tab: 'access',
    focus: PASSKEYS_FOCUS,
    label: 'Passkeys',
    keywords:
      'passkey passkeys touch id windows hello face id fingerprint biometric sign in without password webauthn',
    icon: <FingerprintPattern />,
  },
  {
    tab: 'security',
    focus: ADDRESS_FOCUS,
    label: 'Your address',
    keywords:
      'address domain subdomain own domain https ssl tls certificate lets encrypt let’s encrypt dns record server vps open from anywhere internet',
    icon: <GlobeLock />,
  },
  {
    tab: 'access',
    focus: DEVICES_FOCUS,
    label: 'Devices',
    keywords:
      'approve new devices approval waiting pending phone laptop tablet browser signed in sign out remove trusted allow lost stolen which devices get notifications stop',
    icon: <MonitorSmartphone />,
  },
  {
    tab: 'access',
    focus: REACH_FOCUS,
    label: 'Use Conch on your phone',
    keywords:
      'reach phone from anywhere tailscale wi-fi wifi network ssh tunnel remote away from home encrypted',
    icon: <Smartphone />,
  },
  {
    tab: 'providers',
    label: 'Providers',
    // Models was a place of its own once: its name still finds where providers are.
    keywords:
      'providers models default provider claude codex openrouter anthropic api key connect ollama local offline',
    icon: <Cpu />,
  },
  {
    tab: 'browser',
    label: 'Browser',
    keywords: 'web browse chrome edge repair show panel',
    icon: <Globe />,
  },
  {
    tab: 'browser',
    label: 'Where the browser runs',
    keywords:
      'where it runs my chrome own browser cloud browserbase steel cdp remote debugging devtools cookies banners local localhost sites always allowed sign out of every site',
    icon: <Globe />,
  },
  {
    tab: 'terminal',
    label: 'Terminal',
    keywords:
      'shell powershell bash zsh console command line text size font cursor blinking screen reader looks',
    icon: <SquareTerminal />,
  },
  {
    tab: 'terminal',
    label: 'Terminals from other devices',
    keywords: 'remote devices phone other computers allow open terminals elsewhere',
    icon: <SquareTerminal />,
  },
  {
    tab: 'access',
    focus: OTHER_APPS_FOCUS,
    label: 'Other apps',
    keywords:
      'other apps claude desktop cursor vs code vscode visual studio code zed windsurf mcp server connect conch to use from elsewhere editor ide pair paired',
    icon: <Cable />,
  },
];

/**
 * Rank by name, forgiving typos; then, by whole-word prefix, the keywords (an
 * id, a provider, a description); then the names that only matched loosely.
 * A word of the keywords beats a name that merely has its letters in order
 * ("ssh" is Where work runs, not Shimmer). Loose subsequence matching over long
 * keyword strings finds nonsense ("meet" in "remember forget"), so keywords
 * only count by whole-word prefix.
 */
function find<T>(
  items: readonly T[],
  query: string,
  label: (item: T) => string,
  keywords: (item: T) => string,
  limit: number,
): { item: T; match: FuzzyMatch }[] {
  const named = fuzzyFilter(items, query, label, items.length);
  const tokens = foldText(query).split(/\s+/).filter(Boolean);
  // A name that has every word typed in it, not just its letters somewhere.
  const close = named.filter((n) => {
    const name = foldText(label(n.item));
    return tokens.every((token) => name.includes(token));
  });
  if (close.length >= limit) return close.slice(0, limit);
  const loose = named.filter((n) => !close.includes(n));
  const others = items
    .filter((item) => !close.some((n) => n.item === item))
    .filter((item) => {
      const words = foldText(keywords(item)).split(/[^\p{L}\p{N}]+/u);
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    })
    .map((item) => loose.find((n) => n.item === item) ?? { item, match: { score: 0, ranges: [] } });
  const rest = loose.filter((n) => !others.includes(n));
  return [...close, ...others, ...rest].slice(0, limit);
}

/**
 * Everything in Conch worth finding by name, for one query: models from every
 * provider, skills, integrations, routines, and every page and setting. Each
 * group is short; typing more narrows it.
 */
export function useFindables(query: string, conversationId: string | undefined): FindableGroup[] {
  const navigate = useNavigate();
  const openSettings = useUi((s) => s.openSettings);
  const setComposerText = useUi((s) => s.setComposerText);
  const openBrowser = useUi((s) => s.openBrowser);
  const toggleTerminal = useUi((s) => s.setTerminalOpen);
  const newTerminal = useUi((s) => s.newTerminal);
  const turn = useTurnOptions(conversationId);
  const { data: skills } = useSkills();
  // Save how I did this (ADR 0058): the open chat's offer, when it earned one.
  const { data: fromWork } = useWorkSuggestions();
  const { data: integrations } = useIntegrations();
  const { data: routines } = useRoutines();
  const { data: artifacts } = useArtifacts();
  const { data: conchApps } = useConchApps();
  const openArtifact = useUi((s) => s.openArtifact);
  // The sidebar keeps the tasks loaded; reading them here costs no fetch of its own.
  const tasks = useQueryClient().getQueryData<TaskList>(taskKeys.all);
  const { data: vault } = useVault();
  const { data: channels } = useChannels();
  const { data: terminal } = useTerminalStatus();
  const { data: updates } = useUpdates();
  // What the open chat is held to (ADR 0047): each can be let go of by name.
  const holds = useLiveStore((s) => (conversationId ? s.views[conversationId]?.holds : undefined));
  const { data: conversations } = useConversations();
  // Your agents (ADR 0101): a new chat with one, or this chat answered by one.
  const { data: agents } = useAgents();
  const setDraftAgent = useUi((s) => s.setDraftAgent);
  const openNewAgent = useUi((s) => s.openNewAgent);
  const { archive, unarchive } = useArchive();
  // The chat list, organised (ADR 0089): folders by name, pinning and filing the open chat.
  const { data: folders } = useFolders();
  const { pin, fileIn } = useOrganise();
  const showFolder = useUi((s) => s.showFolder);
  const openFolderDialog = useUi((s) => s.openFolderDialog);
  const narrow = useMediaQuery(NARROW);
  const { isQuiet, setQuiet } = useQuietChat();
  const here = conversations?.find((c) => c.id === conversationId);
  const offerHere = conversationId
    ? fromWork?.suggestions.find((s) => s.chat?.conversationId === conversationId)
    : undefined;
  const q = query.trim();
  // Discover (ADR 0074): the shelf as it was last seen, and, once typing pauses, a search.
  const searched = useDebounced(q, 400);
  const { data: shelf } = useMarket('', undefined, Boolean(q));
  const { data: matched } = useMarket(searched, undefined, searched.length >= 3);
  if (!q) return [];

  const models = (turn.catalog?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ provider, model, label: modelLabel(model.label).label })),
  );
  const many = (turn.catalog?.providers.length ?? 0) > 1;
  const modelItems = find(
    models,
    q,
    (m) => m.label,
    (m) =>
      `${m.model.id} ${m.provider.label}${canUseApps(m.provider, m.model) ? '' : ` ${CHAT_ONLY_WORDS}`}`,
    5,
  ).map(({ item, match }): Findable => {
    const key = modelKey(item.provider.engine, item.model.id);
    const current =
      turn.options.engine === item.provider.engine && turn.model?.id === item.model.id;
    return {
      id: `model:${key}`,
      label: item.label,
      ranges: match.ranges,
      description: [
        many && item.provider.label,
        // A model that can only chat says so here too (ADR 0050).
        !canUseApps(item.provider, item.model) && CHAT_ONLY_WORDS,
        item.model.description,
      ]
        .filter(Boolean)
        .join(META_SEP),
      hint: current ? 'In use' : conversationId ? 'Use in this chat' : 'Use',
      icon: <ProviderLogo provider={providerLogo(item.provider.engine)} size={16} />,
      run: () => {
        turn.choose(key);
        toast.success(`Using ${item.label}`, {
          description: many ? item.provider.label : undefined,
        });
      },
    };
  });

  const skillItems = find(
    skills?.skills ?? [],
    q,
    (s) => s.title,
    (s) => `${s.name} ${s.description}`,
    5,
  ).map(({ item, match }): Findable => {
    const usable = item.mode !== 'off' && !item.problem;
    return {
      id: `skill:${item.id}`,
      label: item.title,
      ranges: match.ranges,
      description: item.description,
      hint: usable ? `/${item.name}` : `Off${META_SEP}open`,
      icon: <SkillIcon name={item.name} title={item.title} size="sm" />,
      run: usable
        ? () => {
            // Into the composer, ready for whatever it should work on.
            setComposerText(`/${item.name} `);
            if (!conversationId) void navigate('/');
          }
        : () => void navigate(`/skills/${encodeURIComponent(item.id)}`),
    };
  });

  const sharedSeen = new Map(
    [...(matched?.listings ?? []), ...(shelf?.listings ?? [])]
      .filter((l) => !l.installed && l.trust !== 'blocked')
      .map((l) => [l.id, l]),
  );
  const sharedItems = find(
    [...sharedSeen.values()],
    q,
    (l) => l.title,
    (l) => `${l.name} ${l.description} ${l.sourceLabel} ${l.category ?? ''}`,
    4,
  ).map(({ item, match }): Findable => ({
    id: `market:${item.id}`,
    label: item.title,
    ranges: match.ranges,
    description: item.description,
    hint: `Discover${META_SEP}${item.sourceLabel}`,
    icon: <SkillIcon name={item.name} title={item.title} size="sm" />,
    run: () => void navigate(listingPath(item.id)),
  }));

  const connected = integrations?.integrations ?? [];
  const apps: {
    id: string;
    name: string;
    brand: string;
    color?: string;
    connected: boolean;
    app?: AppIconLook;
  }[] = [
    ...connected.map((i) => {
      const conch = conchApps?.find((a) => a.id === i.conchApp);
      return {
        id: i.id,
        name: i.name,
        brand: i.catalogId ?? 'custom',
        color: integrations?.catalog.find((c) => c.id === i.catalogId)?.color,
        connected: true,
        // An app you made or added wears its own icon (ADR 0061), its picture too (ADR 0090).
        ...(conch && { app: appLook(conch) }),
      };
    }),
    ...(integrations?.catalog ?? [])
      .filter((c) => !connected.some((i) => i.catalogId === c.id))
      .map((c) => ({ id: c.id, name: c.name, brand: c.id, color: c.color, connected: false })),
    // Password managers are apps too (ADR 0052): each opens its page, on or not.
    ...(vault?.status.sources ?? [])
      .filter((s) => s.id !== '1password' && isManager(s))
      .map((s) => ({
        id: s.id,
        name: s.name,
        brand: s.id,
        color: vaultSourceColor(s.id),
        connected: true,
      })),
  ];
  const appItems = find(
    apps,
    q,
    (a) => a.name,
    (a) => a.id,
    4,
  ).map(({ item, match }): Findable => ({
    id: `app:${item.id}`,
    label: item.name,
    ranges: match.ranges,
    hint: item.connected ? 'Open' : 'Connect',
    icon: item.app ? (
      <AppIcon {...item.app} size="xs" />
    ) : (
      <IntegrationLogo
        brand={item.brand}
        name={item.name}
        color={item.color}
        size="xs"
        decorative
      />
    ),
    run: () =>
      void navigate(
        // 1Password is one entry point for its two halves: its page, either way.
        item.connected || item.id === '1password' ? `/apps/${item.id}` : `/apps?connect=${item.id}`,
      ),
  }));

  // Chat apps: the bots you connected (open them) and the apps you can add (connect one).
  const reachable = [
    ...(channels?.channels ?? []).map((c) => ({
      id: c.id,
      label: `${c.bot.name} on ${APPS[c.kind].name}`,
      keywords: `${APPS[c.kind].name} ${c.bot.username ?? c.bot.address ?? ''} ${c.bot.phone ?? ''} ${APP_WORDS[c.kind] ?? ''} channel bot phone`,
      brand: c.kind as string,
      color: APPS[c.kind].color,
      to: `/channels/${c.id}`,
      hint: 'Open',
    })),
    ...(channels?.catalog ?? [])
      .filter((c) => c.available)
      .map((c) => ({
        id: `new-${c.id}`,
        label: `Connect ${c.name}`,
        keywords: `${c.name} ${APP_WORDS[c.id] ?? ''} channel bot phone chat message reach`,
        brand: c.id,
        color: c.color,
        to: `/channels/new/${c.id}`,
        hint: `About ${c.minutes ?? 2} min`,
      })),
  ];
  const channelItems = find(
    reachable,
    q,
    (c) => c.label,
    (c) => c.keywords,
    4,
  ).map(({ item, match }): Findable => ({
    id: `channel:${item.id}`,
    label: item.label,
    ranges: match.ranges,
    hint: item.hint,
    icon: (
      <IntegrationLogo
        brand={item.brand}
        name={item.label}
        color={item.color}
        size="xs"
        decorative
      />
    ),
    run: () => void navigate(item.to),
  }));

  const passwordItems = find(
    (vault?.items ?? []).filter((i) => !i.deletedAt),
    q,
    (i) => i.title,
    (i) => [i.subtitle, ...i.domains, ...i.tags, i.type, 'password login'].join(' '),
    5,
  ).map(({ item, match }): Findable => ({
    id: `password:${item.id}`,
    label: item.title,
    ranges: match.ranges,
    description: item.subtitle || item.domains[0],
    icon: <VaultKindGlyph kind={item.type} />,
    run: () => void navigate(`/passwords/${item.id}`),
  }));

  const routineItems = find(
    routines ?? [],
    q,
    (r) => r.title,
    (r) => r.summary,
    4,
  ).map(({ item, match }): Findable => ({
    id: `routine:${item.id}`,
    label: item.title,
    ranges: match.ranges,
    description: item.scheduleText,
    icon: <Repeat />,
    run: () => void navigate(`/routines/${item.id}`),
  }));

  // Folders in the chat list (ADR 0089): open in the sidebar, unfolded; or the open chat moved in.
  const folderItems = find(
    folders ?? [],
    q,
    (f) => f.name,
    () => 'folder chats group',
    4,
  ).map(({ item, match }): Findable => ({
    id: `folder:${item.id}`,
    label: item.name,
    ranges: match.ranges,
    description: 'Folder',
    icon: <FolderMark glyph={item.glyph} color={item.color} size="xs" />,
    run: () => showFolder(item.id, narrow),
  }));
  // A new chat straight into a folder, as its ✎ in the sidebar starts one.
  const newInItems = find(
    /\b(?:new|start|begin)\b/i.test(q) ? (folders ?? []) : [],
    q,
    (f) => `New chat in ${f.name}`,
    (f) => `new start begin chat conversation in folder ${f.name}`,
    3,
  ).map(({ item, match }): Findable => ({
    id: `new-in:${item.id}`,
    label: `New chat in ${item.name}`,
    ranges: match.ranges,
    icon: <FolderMark glyph={item.glyph} color={item.color} size="xs" />,
    run: () => void navigate('/', { state: { folder: item.id } }),
  }));
  const moveItems = find(
    here && isChat(here) && /\b(?:move|file|folder|put)\b/i.test(q)
      ? (folders ?? []).filter((f) => f.id !== here.folderId)
      : [],
    q,
    (f) => `Move this chat to ${f.name}`,
    (f) => `move file put folder ${f.name}`,
    3,
  ).map(({ item, match }): Findable => ({
    id: `move-to:${item.id}`,
    label: `Move this chat to ${item.name}`,
    ranges: match.ranges,
    icon: <FolderMark glyph={item.glyph} color={item.color} size="xs" />,
    run: () => {
      if (here) void fileIn([here], item);
    },
  }));

  // The pages of apps you made or added (ADR 0061): "Plant diary — Plants".
  const conchPages = (conchApps ?? []).flatMap((a) =>
    a.manifest.pages.map((page) => ({
      key: `${a.id}/${page.id}`,
      label:
        page.title.toLowerCase() === a.manifest.name.toLowerCase()
          ? `${a.manifest.name} page`
          : `${a.manifest.name} — ${page.title}`,
      words: `${a.manifest.name} ${page.title} ${a.manifest.tagline} page open app`,
      to: conchPagePath(a.id, page.id),
      icon: appLook(a),
    })),
  );
  const pageItems = find(
    conchPages,
    q,
    (p) => p.label,
    (p) => p.words,
    4,
  ).map(({ item, match }): Findable => ({
    id: `app-page:${item.key}`,
    label: item.label,
    ranges: match.ranges,
    hint: 'Open',
    icon: <AppIcon {...item.icon} size="xs" />,
    run: () => void navigate(item.to),
  }));

  // Things made in chats (ADR 0034): a pinned app opens on its page, anything else beside its chat.
  const artifactItems = find(
    artifacts ?? [],
    q,
    (a) => a.title,
    (a) => `${ARTIFACT_KINDS[a.kind].label} ${a.pinned ? 'app pinned' : ''}`,
    4,
  ).map(({ item, match }): Findable => ({
    id: `artifact:${item.id}`,
    label: item.title,
    ranges: match.ranges,
    description: `${ARTIFACT_KINDS[item.kind].label}${item.pinned ? `${META_SEP}pinned` : ''}`,
    icon: ARTIFACT_KINDS[item.kind].icon,
    run: () => {
      if (item.pinned || !item.conversationId) return void navigate(`/apps/${item.id}`);
      openArtifact(item.conversationId, item.id);
      void navigate(`/c/${item.conversationId}`);
    },
  }));
  // Editing one by hand (ADR 0046): asked for in words ("edit the budget"), the
  // closest two, straight into the editor. Not offered for a plain name: that opens it.
  const editItems = find(
    /\b(?:edit|change|fix)\b/i.test(q) ? (artifacts ?? []) : [],
    q,
    (a) => `Edit “${a.title}”`,
    (a) => `edit change fix by hand ${a.title} ${ARTIFACT_KINDS[a.kind].label}`,
    2,
  ).map(({ item, match }): Findable => ({
    id: `artifact-edit:${item.id}`,
    label: `Edit “${item.title}”`,
    ranges: match.ranges,
    description: `${ARTIFACT_KINDS[item.kind].label}${META_SEP}by hand`,
    icon: <Pencil />,
    run: () => {
      useUi.setState({ artifactEditRequest: item.id });
      if (item.pinned || !item.conversationId) return void navigate(`/apps/${item.id}`);
      openArtifact(item.conversationId, item.id);
      void navigate(`/c/${item.conversationId}`);
    },
  }));
  const taskItems = find(
    // Helpers too: each is a chat of its own, under the chat that started it.
    (tasks?.tasks ?? []).filter((t) => t.conversationId),
    q,
    (t) => t.title,
    (t) => t.summary ?? '',
    4,
  ).map(({ item, match }): Findable => ({
    id: `task:${item.id}`,
    label: item.title,
    ranges: match.ranges,
    description: item.summary,
    icon: <ListChecks />,
    run: () => void navigate(`/c/${item.conversationId}`),
  }));

  // "Start now" (ADR 0128): a task that waits only for room, started by its name.
  const startNowItems = find(
    (tasks?.tasks ?? []).filter(
      (t) => t.status === 'queued' && t.waiting?.canStartNow && !t.startNow,
    ),
    q,
    (t) => `Start “${t.title}” now`,
    (t) => `start now anyway go ahead waiting queued run ${t.title}`,
    2,
  ).map(({ item, match }): Findable => ({
    id: `task-start:${item.id}`,
    label: `Start “${item.title}” now`,
    ranges: match.ranges,
    description: item.waiting?.words,
    icon: <Play />,
    run: () =>
      void tasksApi
        .startNow(item.id)
        .catch((error: unknown) =>
          toast.error(error instanceof ApiError ? error.message : 'Couldn’t start it now.'),
        ),
  }));

  const places: {
    id: string;
    label: string;
    keywords: string;
    icon: ReactNode;
    run: () => void;
  }[] = [
    {
      id: 'attach',
      label: 'Attach files',
      keywords: 'upload file picture image photo pdf document add paperclip',
      icon: <Paperclip />,
      run: () => useUi.getState().requestAttach(),
    },
    {
      id: 'background-task',
      label: 'Run as a task',
      keywords: 'task background later async send away hand off delegate queue while i work',
      icon: <ListPlus />,
      run: () => {
        // It sends what's written in the open chat; elsewhere there's nothing written yet.
        if (/^\/(c\/|$)/.test(window.location.pathname))
          return useUi.getState().requestBackground();
        void navigate('/');
        toast('Write what you’d like done, then choose “Run as a task”.');
      },
    },
    {
      id: 'tasks',
      label: 'Tasks going now',
      keywords: 'tasks background jobs running working queue helpers progress needs ok',
      icon: <ListChecks />,
      run: () => {
        // The pearl's list, when something's going; nothing going, it says so.
        if (tasks?.tasks.some(going)) useUi.getState().setPulseOpen(true);
        else toast('No tasks going right now.');
      },
    },
    {
      id: 'backup-now',
      label: 'Back up now',
      keywords: 'backup back up save copy export download archive keep safe',
      icon: <Archive />,
      run: () => openSettings('health', 'backup'),
    },
    {
      id: 'quit-conch',
      label: 'Quit Conch',
      keywords: 'quit stop exit shut down close turn off conch',
      icon: <Power />,
      run: () => openSettings('health', BACKGROUND_FOCUS),
    },
    {
      id: 'restore-backup',
      label: 'Restore a backup',
      keywords: 'restore backup undo go back recover import upload file conchbackup',
      icon: <History />,
      run: () => openSettings('health', 'restore'),
    },
    {
      id: 'come-home',
      label: 'Bring your things from OpenClaw or Hermes',
      keywords:
        'import move migrate switch bring come home openclaw clawdbot moltbot hermes agent memories skills persona soul',
      icon: <House />,
      run: () => openSettings('memory', COME_HOME_FOCUS),
    },
    {
      id: 'past-chats',
      label: 'Bring in your past chats from other apps',
      keywords:
        'import past chats conversations history sessions transcripts claude code codex gemini cli opencode copilot openclaw hermes bring in old',
      icon: <MessagesSquare />,
      run: () => openSettings('memory', PAST_CHATS_FOCUS),
    },
    {
      id: 'passwords',
      label: 'Passwords',
      keywords:
        'password passwords login logins keychain vault credentials secret secrets keys card cards 2fa codes otp 1password bitwarden keepass',
      icon: <KeyRound />,
      run: () => void navigate('/passwords'),
    },
    {
      id: 'new-password',
      label: 'New password',
      keywords: 'add save store login credential secret card note key vault',
      icon: <Plus />,
      run: () => void navigate('/passwords', { state: { new: 'login' } }),
    },
    {
      id: 'generate-password',
      label: 'Generate a password',
      keywords: 'make create random strong new password passphrase generator copy',
      icon: <Sparkles />,
      run: () => {
        const value = generatePassword();
        void copySecret(value, 'New password');
      },
    },
    {
      id: 'import-passwords',
      label: 'Import passwords',
      keywords:
        'import passwords chrome safari firefox 1password bitwarden lastpass keepass csv move',
      icon: <Upload />,
      run: () => void navigate('/passwords', { state: { import: true } }),
    },
    {
      id: 'onepassword-settings',
      label: 'Connect 1Password',
      keywords:
        '1password one password service account token ops server headless remote vaults op cli app desktop',
      icon: <KeyRound />,
      run: () => void navigate('/passwords', { state: { manage: '1password' } }),
    },
    {
      id: 'password-check',
      label: 'Check my passwords',
      keywords: 'security check breach breached leaked pwned weak reused health',
      icon: <ShieldCheck />,
      run: () => void navigate('/passwords', { state: { check: true } }),
    },
    {
      id: 'undo-last',
      label: 'Undo the last change',
      keywords: 'undo revert put back restore file files change edit mistake oops go back rollback',
      icon: <Undo2 />,
      run: () => void undoLast(),
    },
    {
      id: 'memory-page',
      label: 'What Conch knows about you',
      keywords:
        'what do you know remember about me memory memories remembered profile forget learned learnings recently lately picked up noticed corrections self improving improve automatically',
      icon: <Brain />,
      run: () => openSettings('memory', MEMORY_ALL),
    },
    {
      id: 'tidy-memory',
      label: 'Tidy up memories',
      keywords: 'tidy clean merge duplicates repeats memories dream sleep nightly learn',
      icon: <Sparkles />,
      run: () => {
        useUi.getState().setMemoryIntent('tidy');
        openSettings('memory', MEMORY_ALL);
      },
    },
    {
      id: 'meaning-search',
      label: 'Search memories by meaning',
      keywords:
        'meaning understand synonyms smarter search memories model download embedding semantic offline',
      icon: <Brain />,
      run: () => {
        useUi.getState().setMemoryIntent('meaning');
        openSettings('memory', MEMORY_ALL);
      },
    },
    // Quiet learning (ADR 0088, ADR 0097): what it learned is the Memory page itself.
    {
      id: 'never-learn',
      label: 'Things Conch won’t learn again',
      keywords:
        'never learn again taken back undone forgotten blocked do not learn ignore list remove relearn',
      icon: <CircleOff />,
      run: () => {
        useUi.getState().setMemoryIntent(NEVER_INTENT);
        openSettings('memory', MEMORY_ALL);
      },
    },
    {
      id: 'export-memories',
      label: 'Export what Conch knows',
      keywords: 'export download save memories markdown json',
      icon: <Download />,
      run: () => downloadMemories('md'),
    },
    {
      id: 'activity',
      label: 'Activity',
      keywords: 'activity history log audit timeline what did it do commands ran files changed',
      icon: <History />,
      run: () => void navigate('/activity'),
    },
    {
      id: 'new-agent',
      label: 'New agent',
      keywords: 'agent create make add new assistant persona character profile',
      icon: <UserRoundPlus />,
      run: () => openNewAgent(),
    },
    {
      id: 'new-folder',
      label: 'New folder',
      keywords: 'folder create make add new group organise organize sort chats',
      icon: <FolderPlus />,
      run: () => openFolderDialog(here && isChat(here) && !here.archivedAt ? [here.id] : undefined),
    },
    {
      id: 'archived',
      label: 'Archived chats',
      keywords: 'archive archived put away hidden old chats conversations unarchive restore',
      icon: <Archive />,
      run: () => void navigate(ARCHIVE_PATH),
    },
    // The chat you're in: out of the list, or back into it.
    ...(here && isChat(here)
      ? [
          here.archivedAt
            ? {
                id: 'unarchive-chat',
                label: 'Unarchive this chat',
                keywords: 'archived put back restore return list unhide',
                icon: <ArchiveRestore />,
                run: () => void unarchive(here, { quiet: true }),
              }
            : {
                id: 'archive-chat',
                label: 'Archive this chat',
                keywords: 'archive put away hide tidy declutter remove from list',
                icon: <Archive />,
                run: () => void archive(here),
              },
          ...(here.archivedAt
            ? []
            : [
                here.pinned !== undefined
                  ? {
                      id: 'unpin-chat',
                      label: 'Unpin this chat',
                      keywords: 'unpin remove from top pinned',
                      icon: <PinOff />,
                      run: () => void pin([here], false),
                    }
                  : {
                      id: 'pin-chat',
                      label: 'Pin this chat',
                      keywords: 'pin keep top favourite favorite star important stick',
                      icon: <Pin />,
                      run: () => void pin([here], true),
                    },
              ]),
          ...(here.folderId
            ? [
                {
                  id: 'unfile-chat',
                  label: 'Take this chat out of its folder',
                  keywords: 'remove from folder unfile move out back to list',
                  icon: <FolderMinus />,
                  run: () => void fileIn([here], null),
                },
              ]
            : []),
          isQuiet(here.id)
            ? {
                id: 'learn-chat',
                label: 'Learn from this chat again',
                keywords: 'learn learning remember again resume turn on this chat',
                icon: <Sparkles />,
                run: () => void setQuiet(here.id, false),
              }
            : {
                id: 'quiet-chat',
                label: 'Don’t learn from this chat',
                keywords:
                  'do not learn dont stop learning private incognito off the record forget this chat remember nothing',
                icon: <CircleOff />,
                run: () => void setQuiet(here.id, true),
              },
        ]
      : []),
    {
      id: 'skills',
      label: 'Skills',
      keywords: 'skill teach',
      icon: <WandSparkles />,
      run: () => void navigate('/skills'),
    },
    {
      id: 'discover-skills',
      label: 'Discover skills',
      keywords:
        'discover find browse add install get skills people share marketplace market store community clawhub skills.sh anthropic new ideas',
      icon: <Compass />,
      run: () => void navigate('/skills/discover'),
    },
    {
      id: 'skill-publishers',
      label: 'Skill publishers you trust',
      keywords: 'skill signed signature verified publisher key fingerprint',
      icon: <BadgeCheck />,
      run: () => void navigate('/skills', { state: { focus: 'publishers' } }),
    },
    {
      // Commands left Settings for Skills: Your commands.
      id: 'commands',
      label: 'Your commands',
      keywords: 'commands slash prompts saved shortcuts custom new command',
      icon: <SquareSlash />,
      run: () => void navigate('/skills', { state: { focus: COMMANDS_FOCUS } }),
    },
    {
      id: 'new-skill',
      label: 'New skill',
      keywords: 'teach create skill',
      icon: <Plus />,
      run: () => void navigate('/skills/new'),
    },
    ...(offerHere
      ? [
          {
            id: 'save-how',
            label: 'Save how I did this as a skill',
            keywords:
              'save how i did this as a skill learn keep remember the steps workflow procedure recipe what worked make skill from chat',
            icon: <RouteIcon />,
            run: () => void navigate('/skills/new', { state: draftFrom(offerHere) }),
          },
        ]
      : []),
    {
      // What the tidy shelf turns off (ADR 0058): kept, backed up, never offered.
      id: 'skills-off',
      label: 'Skills that are off',
      keywords:
        'skills off turned off disabled archived archive unused stale tidy shelf put away hidden restore bring back',
      icon: <CirclePause />,
      run: () => void navigate('/skills?show=off'),
    },
    {
      id: 'routines',
      label: 'Routines',
      keywords: 'schedule cron',
      icon: <Repeat />,
      run: () => void navigate('/routines'),
    },
    {
      // When… (ADR 0056): a routine that starts from what happens, not a time.
      id: 'new-when-routine',
      label: 'New routine that starts when…',
      keywords:
        'when something happens tell me let me know watch notify alert email arrives replies meeting calendar page changes website folder file task finishes webhook trigger heartbeat monitor',
      icon: <Zap />,
      run: () => void navigate('/routines', { state: { create: 'when' } }),
    },
    {
      // Standing orders and the check-in (ADR 0107): on the Routines page.
      id: 'standing-orders',
      label: 'Standing orders and check-ins',
      keywords:
        'standing orders order always tell me let me know you may allowed wishes rules instructions check in check-ins checkin heartbeat watch for keep an eye out interrupt notify notifications quiet hours night',
      icon: <Bell />,
      run: () => void navigate('/routines?checkin=1'),
    },
    {
      // The morning's note (ADR 0107): what learning and the nightly tidy-up did, with Undo.
      id: 'morning-note',
      label: 'What Conch learned overnight',
      keywords:
        'morning note digest overnight last night while you slept nightly tidy tidied learned dreaming dreams consolidation undo memory memories',
      icon: <Sunrise />,
      // Atop Settings → What Conch knows, its only place.
      run: () => openSettings('memory'),
    },
    {
      // What used to be the Channels page: a filter of Apps now (ADR 0052).
      id: 'talk',
      label: 'Talk to me here',
      keywords:
        'channels chat apps telegram discord slack whatsapp signal imessage email teams matrix wechat sms text mattermost line rocketchat googlechat feishu lark dingtalk qq google chat phone mobile message reach bot remote',
      icon: <MessagesSquare />,
      run: () => void navigate('/apps?show=talk'),
    },
    {
      // Apps you make (ADR 0061): Add your own, open on Describe it.
      id: 'make-app',
      label: 'Make an app',
      keywords:
        'make build create new app my own custom tool maker describe conch app track remember log counter',
      icon: <WandSparkles />,
      run: () => void navigate('/apps?add=describe'),
    },
    {
      // A provider or a chat app made with Conch (ADR 0122): Add your own, where each lives.
      id: 'make-provider',
      label: 'Add any provider with Conch',
      keywords:
        'add make new provider model api company openai compatible anthropic compatible custom endpoint fireworks baseten my own',
      icon: <WandSparkles />,
      run: () => openSettings('providers'),
    },
    {
      id: 'make-chat-app',
      label: 'Add any chat app with Conch',
      keywords:
        'add make new chat app channel talk to me here bot messenger zulip threema revolt my own connect',
      icon: <WandSparkles />,
      run: () => void navigate('/apps?show=talk'),
    },
    {
      id: 'add-app-link',
      label: 'Add an app from a link',
      keywords:
        'add install app link address github repository file conchapp shared someone community import',
      icon: <Download />,
      run: () => void navigate('/apps?add=link'),
    },
    {
      id: 'apps',
      label: 'Apps',
      keywords:
        'integrations integration connect mcp Google Gmail calendar Drive Slack 1Password personal work account app password accounts read write access permissions send',
      icon: <Blocks />,
      run: () => void navigate('/apps'),
    },
    ...(conversationId
      ? [...new Map((holds ?? []).map((h) => [h.skillId, h])).values()].map((hold) => ({
          id: `stop-holding-${hold.skillId}`,
          label: `Stop holding this chat to ${hold.title}’s list`,
          keywords: 'skill held hold limit list permissions let go stop holding allow',
          icon: <ShieldCheck />,
          run: () => useUi.setState({ stopHolding: { conversationId, skillId: hold.skillId } }),
        }))
      : []),
    ...(conversationId
      ? [
          {
            id: 'browser',
            label: 'Show the browser',
            keywords: 'web browse page watch take over',
            icon: <Globe />,
            run: () => openBrowser(conversationId),
          },
          // What this chat spent, and a limit of its own (ADR 0079).
          {
            id: 'chat-spend',
            label: 'What this chat spent',
            keywords:
              'cost costs money spend spent spending price dollars bill tokens cache saved limit cap budget this chat expensive',
            icon: <Coins />,
            run: () => useUi.setState({ chatSpendOpen: conversationId }),
          },
        ]
      : []),
    // Turned off in Settings, the terminal stays out of the way here too.
    ...(terminal?.settings.enabled === false
      ? []
      : [
          {
            id: 'terminal',
            label: 'Show the terminal',
            keywords: 'shell console command line cli',
            icon: <SquareTerminal />,
            run: () => toggleTerminal(true),
          },
          {
            id: 'new-terminal',
            label: 'New terminal',
            keywords: 'shell console open another',
            icon: <SquareTerminal />,
            run: () => newTerminal(),
          },
        ]),
    {
      id: 'repair',
      label: 'Repair everything',
      keywords: 'fix broken doctor check health not working help',
      icon: <Wrench />,
      // Starts at once; the Health tab shows it filling in.
      run: () => {
        void doctorApi.repair().catch(() => undefined);
        openSettings('health');
      },
    },
    {
      // A model on this computer (ADR 0022): straight to its setup page.
      id: 'local-model',
      label: 'Model on this computer',
      keywords: 'local offline private free model ollama llama qwen download run laptop',
      icon: <Laptop />,
      run: () => openSettings('providers', 'ollama'),
    },
    // Your company's cloud (ADR 0109): straight to the page that picks an account.
    {
      id: 'cloud-bedrock',
      label: 'Amazon Bedrock',
      keywords: 'aws amazon bedrock sso profile company cloud enterprise claude',
      icon: <Cpu />,
      run: () => openSettings('providers', 'bedrock'),
    },
    {
      id: 'cloud-vertex',
      label: 'Google Vertex AI',
      keywords: 'google cloud gcp vertex gcloud project company enterprise claude',
      icon: <Cpu />,
      run: () => openSettings('providers', 'vertex'),
    },
    {
      id: 'cloud-azure',
      label: 'Azure OpenAI',
      keywords: 'azure microsoft foundry openai entra company cloud enterprise deployment',
      icon: <Cpu />,
      run: () => openSettings('providers', 'azure-openai'),
    },
    // Checking opens Settings → Health and looks; updating opens the update
    // dialog, which says what it brings first.
    {
      id: 'check-updates',
      label: 'Check for updates',
      keywords: 'update updates upgrade new version latest software programs check',
      icon: <RefreshCw />,
      run: () => openSettings('health', 'check-updates'),
    },
    ...(updates && updates.conch.behind > 0 && !updates.conch.running
      ? [
          {
            id: 'update-conch',
            label: updates.conch.latest
              ? `Update Conch to ${updates.conch.latest.version.replace(/^(\d+\.\d+)\.0$/, '$1')}`
              : 'Update Conch',
            keywords: 'update upgrade install new version latest restart',
            icon: <CircleArrowUp />,
            // What it brings, and one press: the update dialog.
            run: () => useUi.getState().openUpdate(),
          },
        ]
      : []),
    {
      // Stable, beta or alpha (ADR 0051): Settings → Health → Updates.
      id: 'release-channel',
      label: 'Release channel: stable, beta or alpha',
      keywords: 'release channel stable beta alpha preview early versions updates choose',
      icon: <CircleArrowUp />,
      run: () => openSettings('health', 'updates'),
    },
    // One id per row, even where a place has several ways in (Start over, Lustre).
    ...settingsPlaces.map((p) => ({
      id: `settings-${p.tab}-${p.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
      label: `Settings: ${p.label}`,
      keywords: p.keywords,
      icon: p.icon,
      run: () => openSettings(p.tab, p.focus),
    })),
  ];
  const placeItems = find(
    places,
    q,
    (p) => p.label,
    (p) => p.keywords,
    4,
  ).map(({ item, match }): Findable => ({
    id: `place:${item.id}`,
    label: item.label,
    ranges: match.ranges,
    icon: item.icon,
    run: item.run,
  }));

  const answering = agents && here ? chatAgentId(here, agents) : undefined;
  const newChatWith = (agent: Agent) => {
    setDraftAgent(agent.isDefault ? null : agent.id);
    void navigate('/');
  };
  const agentItems = find(
    agents?.agents ?? [],
    q,
    (a) => a.name,
    (a) => `${a.role} agent persona assistant`,
    3,
  ).flatMap(({ item, match }): Findable[] => {
    const face = <AgentAvatar name={item.name} avatar={item.avatar} size="xs" decorative />;
    const edit: Findable = {
      id: `agent-edit:${item.id}`,
      label: `Edit ${item.name}`,
      description: 'Its name, face, voice and instructions',
      icon: face,
      run: () => openSettings('agents', item.id),
    };
    if (!here)
      return [
        {
          id: `agent:${item.id}`,
          label: item.name,
          ranges: match.ranges,
          ...(item.role && { description: item.role }),
          hint: 'New chat',
          icon: face,
          run: () => newChatWith(item),
        },
        edit,
      ];
    return [
      {
        id: `agent:${item.id}`,
        label: item.name,
        ranges: match.ranges,
        ...(item.role && { description: item.role }),
        hint: item.id === answering ? 'Answering' : 'Answer this chat',
        icon: face,
        run: () => {
          if (item.id === answering) return;
          void agentsApi.setChatAgent(here.id, item.id).then(
            () => toast.success(`${item.name} answers from your next message`),
            (error: unknown) =>
              toast.error((error as Error).message || 'That didn’t change who answers. Try again.'),
          );
        },
      },
      {
        id: `agent-new:${item.id}`,
        label: `New chat with ${item.name}`,
        icon: face,
        run: () => newChatWith(item),
      },
      edit,
    ];
  });

  return [
    { heading: 'Go to', items: placeItems },
    { heading: 'Agents', items: agentItems },
    { heading: 'Passwords', items: passwordItems },
    { heading: 'Skills', items: skillItems },
    { heading: 'Skills people share', items: sharedItems },
    { heading: 'Models', items: modelItems },
    { heading: 'Apps', items: [...appItems, ...pageItems] },
    { heading: 'Talk to me here', items: channelItems },
    { heading: 'Folders', items: [...folderItems, ...newInItems, ...moveItems] },
    { heading: 'Routines', items: routineItems },
    { heading: 'Made for you', items: [...artifactItems, ...editItems] },
    { heading: 'Tasks', items: [...startNowItems, ...taskItems] },
  ].filter((group) => group.items.length > 0);
}
