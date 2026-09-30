import type { TextRange } from '@conch/protocol';
import { IntegrationLogo, ProviderLogo, SkillIcon, toast } from '@conch/nacre';
import {
  BatteryMedium,
  Blocks,
  Brain,
  Cpu,
  Gauge,
  Globe,
  Palette as PaletteIcon,
  SquareTerminal,
  Plus,
  Repeat,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  User,
  WandSparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useUi, type SettingsTab } from '../../app/ui';
import { useIntegrations } from '../integrations/queries';
import { modelLabel, providerLogos } from '../models/catalog';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { useRoutines } from '../routines/queries';
import { fuzzyFilter, type FuzzyMatch } from '../search/fuzzy';
import { useSkills } from '../skills/queries';
import { useTerminalStatus } from '../terminal/queries';

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

const settingsPlaces: { tab: SettingsTab; label: string; keywords: string; icon: ReactNode }[] = [
  { tab: 'personality', label: 'Personality', keywords: 'name tone persona', icon: <Sparkles /> },
  { tab: 'about', label: 'About you', keywords: 'profile me', icon: <User /> },
  { tab: 'memory', label: 'Memory', keywords: 'remember forget', icon: <Brain /> },
  {
    tab: 'models',
    label: 'Models & modes',
    keywords: 'default model thinking effort permissions',
    icon: <Gauge />,
  },
  { tab: 'commands', label: 'Commands', keywords: 'slash prompts', icon: <SquareSlash /> },
  { tab: 'usage', label: 'Usage', keywords: 'limits spend budget plan', icon: <BatteryMedium /> },
  {
    tab: 'security',
    label: 'Security',
    keywords: 'password keys devices sign in checkup health fixed repairs healed',
    icon: <ShieldCheck />,
  },
  {
    tab: 'providers',
    label: 'Providers',
    keywords: 'claude codex openrouter anthropic api key connect',
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
  const { data: terminal } = useTerminalStatus();
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
    ...settingsPlaces.map((p) => ({
      id: `settings-${p.tab}`,
      label: `Settings: ${p.label}`,
      keywords: p.keywords,
      icon: p.icon,
      run: () => openSettings(p.tab),
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
    { heading: 'Skills', items: skillItems },
    { heading: 'Models', items: modelItems },
    { heading: 'Integrations', items: appItems },
    { heading: 'Routines', items: routineItems },
  ].filter((group) => group.items.length > 0);
}
