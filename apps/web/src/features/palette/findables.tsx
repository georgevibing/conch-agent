import { generatePassword, type TextRange } from '@conch/protocol';
import { IntegrationLogo, ProviderLogo, SkillIcon, toast, VaultKindGlyph } from '@conch/nacre';
import {
  Archive,
  BatteryMedium,
  Bell,
  Blocks,
  Brain,
  CircleArrowUp,
  Cpu,
  Gauge,
  MessagesSquare,
  MonitorSmartphone,
  Globe,
  HeartPulse,
  Laptop,
  History,
  KeyRound,
  Palette as PaletteIcon,
  Paperclip,
  SquareTerminal,
  Plus,
  Mic,
  Power,
  QrCode,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Upload,
  SquareSlash,
  User,
  WandSparkles,
  WifiOff,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useUi, type SettingsTab } from '../../app/ui';
import { doctorApi } from '../health/api';
import { DEVICES_FOCUS } from '../auth/focus';
import { FALLBACK_FOCUS } from '../settings/FallbackSection';
import { APPS } from '../channels/describe';
import { useChannels } from '../channels/queries';
import { useIntegrations } from '../integrations/queries';
import { copySecret } from '../passwords/clipboard';
import { useVault } from '../passwords/queries';
import { modelLabel, providerLogos } from '../models/catalog';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { useRoutines } from '../routines/queries';
import { fuzzyFilter, type FuzzyMatch } from '../search/fuzzy';
import { useSkills } from '../skills/queries';
import { useTerminalStatus } from '../terminal/queries';
import { useUpdates } from '../updates/queries';
import { ADD_DEVICE_FOCUS } from '../auth/SecurityTab';
import { BACKGROUND_FOCUS } from '../background/AlwaysOnSection';

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
  { tab: 'personality', label: 'Personality', keywords: 'name tone persona', icon: <Sparkles /> },
  { tab: 'about', label: 'About you', keywords: 'profile me', icon: <User /> },
  { tab: 'memory', label: 'Memory', keywords: 'remember forget', icon: <Brain /> },
  {
    tab: 'models',
    label: 'Models & modes',
    keywords:
      'default model thinking effort permissions suggestions suggest connect apps offers muted',
    icon: <Gauge />,
  },
  {
    tab: 'models',
    focus: FALLBACK_FOCUS,
    label: 'When a provider can’t answer',
    keywords:
      'offline internet wifi limit reached fallback continue switch local model ollama wait',
    icon: <WifiOff />,
  },
  { tab: 'commands', label: 'Commands', keywords: 'slash prompts', icon: <SquareSlash /> },
  { tab: 'usage', label: 'Usage', keywords: 'limits spend budget plan', icon: <BatteryMedium /> },
  {
    tab: 'health',
    label: 'Health',
    keywords:
      'repair everything fix doctor checkup broken updates update upgrade backup back up restore fixed healed',
    icon: <HeartPulse />,
  },
  {
    tab: 'notifications',
    label: 'Notifications',
    keywords: 'notifications notify push alerts phone bell badge tell me lock screen',
    icon: <Bell />,
  },
  {
    tab: 'voice',
    label: 'Voice',
    keywords:
      'voice dictation dictate speak talk microphone mic speech whisper read aloud language accent tts stt',
    icon: <Mic />,
  },
  {
    tab: 'security',
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
      'always on background start at login startup login items launch boot keep running daemon service close window',
    icon: <Power />,
  },
  {
    tab: 'security',
    label: 'Security',
    keywords: 'password keys devices sign in checkup',
    icon: <ShieldCheck />,
  },
  {
    tab: 'security',
    focus: DEVICES_FOCUS,
    label: 'Devices',
    keywords:
      'approve new devices approval waiting pending phone laptop signed in sign out remove trusted allow',
    icon: <MonitorSmartphone />,
  },
  {
    tab: 'providers',
    label: 'Providers',
    keywords: 'claude codex openrouter anthropic api key connect ollama local offline',
    icon: <Cpu />,
  },
  {
    tab: 'browser',
    label: 'Browser',
    keywords: 'web browse chrome edge sites cookies sign out local localhost repair',
    icon: <Globe />,
  },
  {
    tab: 'terminal',
    label: 'Terminal',
    keywords: 'shell console command line powershell bash zsh remote devices',
    icon: <SquareTerminal />,
  },
  {
    tab: 'appearance',
    label: 'Appearance',
    keywords: 'theme dark light colour',
    icon: <PaletteIcon />,
  },
];

/**
 * Rank by name, forgiving typos; failing that, every word typed must start a
 * word of the keywords (an id, a provider, a description). Loose subsequence
 * matching over long keyword strings finds nonsense ("meet" in "remember
 * forget"), so keywords only count by whole-word prefix.
 */
function find<T>(
  items: readonly T[],
  query: string,
  label: (item: T) => string,
  keywords: (item: T) => string,
  limit: number,
): { item: T; match: FuzzyMatch }[] {
  const named = fuzzyFilter(items, query, label, limit);
  if (named.length >= limit) return named;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const others = items
    .filter((item) => !named.some((n) => n.item === item))
    .filter((item) => {
      const words = keywords(item)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u);
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    })
    .slice(0, limit - named.length)
    .map((item) => ({ item, match: { score: 0, ranges: [] } }));
  return [...named, ...others];
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
  const { data: integrations } = useIntegrations();
  const { data: routines } = useRoutines();
  const { data: vault } = useVault();
  const { data: channels } = useChannels();
  const { data: terminal } = useTerminalStatus();
  const { data: updates } = useUpdates();
  const q = query.trim();
  if (!q) return [];

  const models = (turn.catalog?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ provider, model, label: modelLabel(model.label).label })),
  );
  const many = (turn.catalog?.providers.length ?? 0) > 1;
  const modelItems = find(
    models,
    q,
    (m) => m.label,
    (m) => `${m.model.id} ${m.provider.label}`,
    5,
  ).map(({ item, match }): Findable => {
    const key = modelKey(item.provider.engine, item.model.id);
    const current =
      turn.options.engine === item.provider.engine && turn.model?.id === item.model.id;
    return {
      id: `model:${key}`,
      label: item.label,
      ranges: match.ranges,
      description: [many && item.provider.label, item.model.description]
        .filter(Boolean)
        .join(' · '),
      hint: current ? 'In use' : conversationId ? 'Use in this chat' : 'Use',
      icon: <ProviderLogo provider={providerLogos[item.provider.engine]} size={16} />,
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
      hint: usable ? `/${item.name}` : 'Off · open',
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

  const connected = integrations?.integrations ?? [];
  const apps = [
    ...connected.map((i) => ({
      id: i.id,
      name: i.name,
      brand: i.catalogId ?? 'custom',
      color: integrations?.catalog.find((c) => c.id === i.catalogId)?.color,
      connected: true,
    })),
    ...(integrations?.catalog ?? [])
      .filter((c) => !connected.some((i) => i.catalogId === c.id))
      .map((c) => ({ id: c.id, name: c.name, brand: c.id, color: c.color, connected: false })),
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
    icon: (
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
        item.connected ? `/integrations/${item.id}` : `/integrations?connect=${item.id}`,
      ),
  }));

  // Chat apps: the bots you connected (open them) and the apps you can add (connect one).
  const reachable = [
    ...(channels?.channels ?? []).map((c) => ({
      id: c.id,
      label: `${c.bot.name} on ${APPS[c.kind].name}`,
      keywords: `${APPS[c.kind].name} ${c.bot.username ?? ''} channel bot phone`,
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
        keywords: `${c.name} channel bot phone chat message reach`,
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
      id: 'password-check',
      label: 'Check my passwords',
      keywords: 'security check breach breached leaked pwned weak reused health',
      icon: <ShieldCheck />,
      run: () => void navigate('/passwords', { state: { check: true } }),
    },
    {
      id: 'activity',
      label: 'Activity',
      keywords: 'activity history log audit timeline what did it do commands ran files changed',
      icon: <History />,
      run: () => void navigate('/activity'),
    },
    {
      id: 'skills',
      label: 'Skills',
      keywords: 'skill teach',
      icon: <WandSparkles />,
      run: () => void navigate('/skills'),
    },
    {
      id: 'new-skill',
      label: 'New skill',
      keywords: 'teach create skill',
      icon: <Plus />,
      run: () => void navigate('/skills/new'),
    },
    {
      id: 'routines',
      label: 'Routines',
      keywords: 'schedule cron',
      icon: <Repeat />,
      run: () => void navigate('/routines'),
    },
    {
      id: 'channels',
      label: 'Channels',
      keywords: 'telegram discord slack whatsapp phone mobile chat message reach bot remote',
      icon: <MessagesSquare />,
      run: () => void navigate('/channels'),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      keywords: 'apps connect mcp',
      icon: <Blocks />,
      run: () => void navigate('/integrations'),
    },
    ...(conversationId
      ? [
          {
            id: 'browser',
            label: 'Show the browser',
            keywords: 'web browse page watch take over',
            icon: <Globe />,
            run: () => openBrowser(conversationId),
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
    // Both open Settings → Health, which checks (or starts the update, asking
    // you to confirm it's you) and shows how it goes.
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
            label: 'Update Conch',
            keywords: 'update upgrade install new version latest restart',
            icon: <CircleArrowUp />,
            run: () => openSettings('health', 'update-conch'),
          },
        ]
      : []),
    ...settingsPlaces.map((p) => ({
      id: `settings-${p.tab}${p.focus ? `-${p.focus}` : ''}`,
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

  return [
    { heading: 'Go to', items: placeItems },
    { heading: 'Passwords', items: passwordItems },
    { heading: 'Skills', items: skillItems },
    { heading: 'Models', items: modelItems },
    { heading: 'Integrations', items: appItems },
    { heading: 'Channels', items: channelItems },
    { heading: 'Routines', items: routineItems },
  ].filter((group) => group.items.length > 0);
}
