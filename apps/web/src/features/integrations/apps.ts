/**
 * One app, one card (ADR 0052). The same real-world app can be several
 * things in Conch: Slack is tools the assistant uses and a bot you talk to,
 * Gmail is tools and an email address you write to, 1Password fills sign-ins
 * in Passwords and manages Environments. Apps shows each as one card, with
 * plain switches for what it does; this file decides which halves belong to
 * which app, and how the card sums them up. Pure, so it's tested on its own.
 */
import type {
  CatalogEntry,
  Channel,
  ChannelCatalogEntry,
  ChannelKind,
  Integration,
  IntegrationTool,
  VaultSource,
} from '@conch/protocol';
import type { IntegrationStateValue } from '@conch/nacre';

import {
  APPS as CHANNEL_APPS,
  channelFix,
  channelMessage,
  channelState,
  needsYou,
  whoOf,
} from '../channels/describe';
import { fixLabel, needsAttention, quietMeta } from './describe';
import { appPath } from './paths';

/** Apps in the gallery that can also talk to you, and the chat app that does it. */
export const TALKS_AS: Partial<Record<string, ChannelKind>> = {
  slack: 'slack',
  gmail: 'email',
};

/** The gallery's filter for the apps you can talk to your assistant from. */
export const TALK = 'talk';

/** One app as Apps shows it: whichever of its halves you have. */
export interface AppItem {
  /** Stable and unique: the catalog id, an integration's id, or `channel:<id>`. */
  key: string;
  name: string;
  /** For the logo. */
  brand: string;
  color?: string;
  /** The catalog entry, when it's a catalog app. */
  entry?: CatalogEntry;
  /** What the assistant uses (an integration, Conch's own Gmail or Slack). */
  integration?: Integration;
  /** Where you talk to it ("Talk to me here"). */
  channels: Channel[];
  /** 1Password's sign-ins in Passwords. */
  source?: VaultSource;
  /** Where its card opens. */
  to: string;
  /** It talks to you, or could. */
  talks: boolean;
}

/** A password manager that's in use here: on, and its program is on this computer. */
export const inUse = (source: VaultSource | undefined) =>
  Boolean(source && source.state !== 'off' && source.state !== 'missing');

/**
 * Everything you have, one item per app. Halves join the app they belong to:
 * a channel by `Channel.app` (the gateway says), 1Password's sign-ins by
 * name. A half without its other half is still that app's card.
 */
export function joinApps({
  integrations,
  catalog,
  channels,
  sources = [],
}: {
  integrations: Integration[];
  catalog: CatalogEntry[];
  channels: Channel[];
  sources?: VaultSource[];
}): AppItem[] {
  const entryOf = (id: string | undefined) => catalog.find((c) => c.id === id);
  const items: AppItem[] = integrations.map((integration) => {
    const entry = entryOf(integration.catalogId);
    return {
      key: integration.id,
      name: integration.name,
      brand: integration.catalogId ?? 'custom',
      ...(entry?.color && { color: entry.color }),
      ...(entry && { entry }),
      integration,
      channels: [],
      to: appPath(integration.id),
      talks: Boolean(integration.catalogId && TALKS_AS[integration.catalogId]),
    };
  });
  /** The card for a catalog app: the integration's, or a new one for a half on its own. */
  const cardFor = (catalogId: string): AppItem | undefined => {
    const found = items.find((i) => i.integration?.catalogId === catalogId || i.key === catalogId);
    if (found) return found;
    const entry = entryOf(catalogId);
    if (!entry) return undefined;
    const item: AppItem = {
      key: catalogId,
      name: entry.name,
      brand: catalogId,
      ...(entry.color && { color: entry.color }),
      entry,
      channels: [],
      to: appPath(catalogId),
      talks: Boolean(TALKS_AS[catalogId]),
    };
    items.push(item);
    return item;
  };
  for (const channel of channels) {
    const owner = channel.app ? cardFor(channel.app) : undefined;
    if (owner) {
      owner.channels.push(channel);
      owner.talks = true;
      continue;
    }
    items.push({
      key: `channel:${channel.id}`,
      name: CHANNEL_APPS[channel.kind].name,
      brand: channel.kind,
      color: CHANNEL_APPS[channel.kind].color,
      channels: [channel],
      to: `/channels/${channel.id}`,
      talks: true,
    });
  }
  const onePassword = sources.find((s) => s.id === '1password');
  if (inUse(onePassword) || items.some((i) => i.integration?.catalogId === '1password')) {
    const card = cardFor('1password');
    if (card && onePassword) card.source = onePassword;
  }
  return items;
}

/** What a card says about an app, whichever halves it has. */
export interface AppCard {
  state: IntegrationStateValue;
  message?: string;
  meta?: string;
  enabled: boolean;
  /** The one thing that fixes what's wrong. */
  fix?: { label: string; channel?: Channel; integration?: Integration };
  /** Something calm to do next (say hello, people waiting), when nothing's wrong. */
  notice?: { message: string; label: string; channel: Channel };
}

const CHANNEL_STATE: Record<ReturnType<typeof channelState>, IntegrationStateValue> = {
  online: 'ok',
  hello: 'ok',
  connecting: 'checking',
  reconnecting: 'checking',
  'needs-token': 'needs-auth',
  access: 'needs-auth',
  conflict: 'warning',
  off: 'off',
  error: 'error',
};

/** A channel that needs a person to fix it (not a hello or a request: those are calm). */
const broken = (channel: Channel) => {
  const state = channelState(channel);
  return state === 'needs-token' || state === 'access' || state === 'conflict' || state === 'error';
};

export function describeApp(item: AppItem, now = Date.now()): AppCard {
  const { integration, channels, source } = item;
  const filling = inUse(source);
  const enabled = Boolean(integration?.enabled) || channels.some((c) => c.enabled) || filling;
  const facts: string[] = [];
  if (integration) facts.push(quietMeta(integration, now));
  const talking = channels.find((c) => c.enabled);
  if (talking) facts.push(integration || source ? 'talks to you here' : whoOf(talking));
  if (filling)
    facts.push(source?.state === 'locked' ? 'fills sign-ins once unlocked' : 'fills sign-ins');
  const meta = facts.join(' · ') || undefined;

  if (!enabled) return { state: 'off', enabled, ...(meta && { meta }) };
  if (integration && needsAttention(integration)) {
    const label = fixLabel(integration);
    return {
      state: integration.health.state,
      message: integration.health.message,
      enabled,
      ...(meta && { meta }),
      ...(label && { fix: { label, integration } }),
    };
  }
  const hurt = channels.find((c) => c.enabled && broken(c));
  if (hurt) {
    const label = channelFix(hurt);
    return {
      state: CHANNEL_STATE[channelState(hurt)],
      message: channelMessage(hurt),
      enabled,
      ...(meta && { meta }),
      ...(label && { fix: { label, channel: hurt } }),
    };
  }
  if (filling && source?.state === 'error')
    return { state: 'error', message: source.message, enabled, ...(meta && { meta }) };
  const waiting = channels.find((c) => c.enabled && needsYou(c));
  const notice = waiting && {
    message:
      channelState(waiting) === 'hello'
        ? (channelMessage(waiting) ?? 'Say hello to finish.')
        : waiting.requests.length === 1
          ? `${waiting.requests[0]?.name ?? 'Someone'} wants to talk to you here.`
          : `${waiting.requests.length} people want to talk to you here.`,
    label: channelFix(waiting) ?? 'Open',
    channel: waiting,
  };
  const state: IntegrationStateValue = integration?.enabled
    ? integration.health.state
    : talking
      ? CHANNEL_STATE[channelState(talking)]
      : 'ok';
  return { state, enabled, ...(meta && { meta }), ...(notice && { notice }) };
}

/** Needs you: something to fix, or a hello or a person waiting. */
export const appNeedsYou = (item: AppItem) => {
  const card = describeApp(item);
  return Boolean(card.fix || card.notice);
};

/** A plain switch for a group of an app's tools (ADR 0052). */
export interface ToolGroup {
  id: string;
  title: string;
  description: string;
  tools: IntegrationTool[];
  /** Asks every time, whatever is chosen: said beside the switch. */
  note?: string;
}

/** What each of Conch's own apps does, in its own words, by tool name. */
const GROUPS: Record<
  string,
  { id: string; title: string; description: string; tools: string[]; note?: string }[]
> = {
  gmail: [
    {
      id: 'read',
      title: 'Read & search',
      description: 'Find emails with Gmail’s own search, and read them.',
      tools: ['google_mail_search', 'google_mail_read'],
    },
    {
      id: 'draft',
      title: 'Draft',
      description: 'Save a new email or a reply in your Drafts, for you to send.',
      tools: ['google_mail_create_draft'],
      note: 'Asks every time. Never sends.',
    },
  ],
  slack: [
    {
      id: 'read',
      title: 'Read & search',
      description: 'See your channels, catch up on them and search your messages.',
      tools: ['slack_channels', 'slack_search', 'slack_read_channel'],
    },
    {
      id: 'send',
      title: 'Send (asks first)',
      description: 'Post a message as you. You see the exact words and say yes each time.',
      tools: ['slack_send_message'],
    },
  ],
  'google-calendar': [
    {
      id: 'read',
      title: 'Read your calendar',
      description: 'See your events, up to a month at a time. It never changes them.',
      tools: ['google_calendar_briefing'],
    },
  ],
  'google-drive': [
    {
      id: 'read',
      title: 'Find files',
      description: 'Search your Drive and read a file’s details, not what’s in it.',
      tools: ['google_drive_search', 'google_drive_read'],
    },
  ],
};

/**
 * An app's tools as a few plain switches: Conch's own apps in their own
 * words, any other app as "Look things up" and "Make changes". Each switch
 * turns its tools off, or back to what the app's policy says.
 */
export function toolGroups(integration: Integration): ToolGroup[] {
  const known = integration.catalogId ? GROUPS[integration.catalogId] : undefined;
  const of = (names: string[]) => integration.tools.filter((t) => names.includes(t.name));
  if (known)
    return known
      .map(({ tools, ...group }) => ({ ...group, tools: of(tools) }))
      .filter((g) => g.tools.length > 0);
  const reads = integration.tools.filter((t) => t.access === 'read' && !t.destructive);
  const writes = integration.tools.filter((t) => !(t.access === 'read' && !t.destructive));
  const groups: ToolGroup[] = [];
  if (reads.length)
    groups.push({
      id: 'read',
      title: 'Look things up',
      description: `Read and search in ${integration.name}.`,
      tools: reads,
    });
  if (writes.length)
    groups.push({
      id: 'write',
      title: integration.policy === 'trust' ? 'Make changes' : 'Make changes (asks first)',
      description: `Create, change or delete things in ${integration.name}.`,
      tools: writes,
    });
  return groups;
}

/** On while any of its tools isn't turned off. */
export const groupOn = (group: ToolGroup) => group.tools.some((t) => t.policy !== 'off');

/** The change that turns a group on (each tool back to the policy) or off. */
export const groupPatch = (group: ToolGroup, on: boolean) =>
  Object.fromEntries(group.tools.map((t) => [t.name, on ? null : ('off' as const)]));

/** The gallery: apps you can add, from both catalogs, one tile each. */
export interface Tile {
  id: string;
  name: string;
  tagline: string;
  color?: string;
  local?: boolean;
  featured?: boolean;
  /** For the filter: the catalog's own category, plus `talk` when it can talk to you. */
  categories: string[];
  /** An app the assistant uses (opens its connect dialog), or a chat app (opens its setup). */
  kind: 'app' | 'chat';
  /** Words to find it by. */
  words: string;
}

export function galleryTiles({
  catalog,
  channelCatalog,
  have,
}: {
  catalog: CatalogEntry[];
  channelCatalog: ChannelCatalogEntry[];
  have: AppItem[];
}): Tile[] {
  const haveCatalog = new Set(have.flatMap((i) => [i.key, i.integration?.catalogId ?? '']));
  const haveKinds = new Set(have.flatMap((i) => i.channels.map((c) => c.kind)));
  const apps: Tile[] = catalog
    .filter((c) => !haveCatalog.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      tagline: c.tagline,
      ...(c.color && { color: c.color }),
      local: c.local,
      featured: c.featured,
      categories: [c.category, ...(TALKS_AS[c.id] ? [TALK] : [])],
      kind: 'app',
      words: `${c.name} ${c.tagline} ${c.description}`.toLowerCase(),
    }));
  // A chat app that's also an app above (Slack) is one tile: the app's. Email
  // stays its own: it's any mail service, and Gmail's becomes Gmail's card.
  const chats: Tile[] = channelCatalog
    .filter((c) => !(c.id in TALKS_AS) && !haveKinds.has(c.id as ChannelKind))
    // Only what this computer can do (iMessage is Mac only).
    .filter((c) => c.available)
    .map((c) => ({
      id: c.id,
      name: c.name,
      tagline: c.short ?? c.tagline,
      color: c.color,
      categories: [TALK],
      kind: 'chat',
      words: `${c.name} ${c.short ?? ''} ${c.tagline}`.toLowerCase(),
    }));
  return [...apps, ...chats];
}
