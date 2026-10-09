/**
 * What a Conch app can do, in plain words (ADR 0061). The chat card, the
 * app's page, the install preview and the assistant's prompt all read these,
 * so a person sees the same sentence wherever they meet an app.
 */
import type { AppChannelPart, AppProviderPart } from './app-parts';
import type { ConchAppChanges, ConchAppManifest, ConchAppSource, ConchAppTool } from './conch-apps';
import type { SkillSignature } from './skills';

/** One line of what an app can do. `kind` picks its icon. */
export interface AppAbilityLine {
  kind: 'data' | 'reach' | 'nothing-else' | 'needs' | 'looks' | 'changes' | 'provider' | 'channel';
  text: string;
}

/** The parts of a manifest the words read (a draft's may be partly filled). */
type ManifestWords = Pick<ConchAppManifest, 'tools'> &
  Partial<Pick<ConchAppManifest, 'reaches' | 'settings' | 'pageState' | 'name'>> & {
    provider?: Pick<AppProviderPart, 'name' | 'speaks' | 'key' | 'models'>;
    channel?: Pick<AppChannelPart, 'name' | 'fields'>;
  };

/** How a provider speaks, in a few words for its card. */
export const SPEAKS_WORDS: Record<AppProviderPart['speaks'], string> = {
  openai: 'OpenAI’s chat',
  anthropic: 'Anthropic’s Messages',
  code: 'its own code',
};

/**
 * What an app brings besides tools and pages (ADR 0119), one plain line
 * each: "Answers chats as Fireworks AI (OpenAI’s chat, 4 models)", "Lets
 * you talk to your assistant on Zulip". Empty for an app that brings neither.
 */
export function partLines(manifest: ManifestWords): AppAbilityLine[] {
  const lines: AppAbilityLine[] = [];
  const provider = manifest.provider;
  if (provider) {
    const name = provider.name ?? manifest.name ?? 'a provider';
    const models = provider.models.length
      ? `${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'}`
      : 'its models read live';
    lines.push({
      kind: 'provider',
      text: `Answers chats as ${name} (${SPEAKS_WORDS[provider.speaks]}, ${models})`,
    });
  }
  const channel = manifest.channel;
  if (channel)
    lines.push({
      kind: 'channel',
      text: `Lets you talk to your assistant on ${channel.name ?? manifest.name ?? 'another app'}; only delivers messages, can’t read your chats or use your apps`,
    });
  return lines;
}

/** What the person types for an app's parts, by name: its key, a bot's token. Never kept in the app. */
export function partKeys(manifest: ManifestWords): string[] {
  const keys: string[] = [];
  if (manifest.provider?.key) keys.push(manifest.provider.key.label);
  for (const field of manifest.channel?.fields ?? []) keys.push(field.label);
  return keys;
}

type ToolWords = Pick<ConchAppTool, 'name' | 'title' | 'changes' | 'cache'>;

/** Names shown in one line before "and 3 more". */
const SHOWN = 4;

/** "log_watering" → "Log watering", for a tool that gave no title. */
export function toolTitle(tool: Pick<ConchAppTool, 'name' | 'title'>): string {
  const title = tool.title.trim();
  if (title) return title;
  const words = tool.name.replaceAll('_', ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "A, B, C, D and 2 more". */
function list(names: readonly string[]): string {
  if (names.length <= SHOWN + 1) return names.join(', ');
  return `${names.slice(0, SHOWN).join(', ')} and ${names.length - SHOWN} more`;
}

/** "a", "a and b", "a, b and c": hosts are always named in full. */
function and(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * What an app can do, one plain line each, in this order: what it keeps,
 * where it reaches, what it can't touch, what it needs from you, then what
 * it looks up and what it changes.
 */
export function appAbilities(
  manifest: ManifestWords,
  tools: readonly ToolWords[],
): AppAbilityLine[] {
  // What it brings first: a provider, a chat app (ADR 0119).
  const lines: AppAbilityLine[] = partLines(manifest);
  const reaches = manifest.reaches ?? [];
  const settings = manifest.settings ?? [];
  // Durable records belong to tools; page preferences and cached reads are separate.
  if (manifest.tools || tools.length)
    lines.push({ kind: 'data', text: 'Keeps its own notes on this computer' });
  if (manifest.pageState)
    lines.push({ kind: 'data', text: 'Remembers page preferences on this computer' });
  if (tools.some((t) => t.cache))
    lines.push({
      kind: 'data',
      text: 'Saves lookup results locally for quick loading and refresh',
    });
  lines.push({
    kind: 'reach',
    text: reaches.length ? `Reaches ${and(reaches)}` : 'Reaches no websites',
  });
  lines.push({
    kind: 'nothing-else',
    text: 'Can’t read your files, run programs or see your other apps',
  });
  const keys = partKeys(manifest);
  if (settings.length || keys.length) {
    const needed = settings.filter((s) => !s.optional).map((s) => s.label);
    const optional = settings.filter((s) => s.optional).map((s) => `${s.label} (optional)`);
    lines.push({
      kind: 'needs',
      text: `Needs from you: ${list([...needed, ...keys, ...optional])}${keys.length ? ' (kept by Conch, never in the app)' : ''}`,
    });
  }
  const looks = tools.filter((t) => !t.changes).map(toolTitle);
  if (looks.length) lines.push({ kind: 'looks', text: `Looks things up: ${list(looks)}` });
  const changes = tools.filter((t) => t.changes).map(toolTitle);
  if (changes.length)
    lines.push({
      kind: 'changes',
      text: `Makes changes: ${list(changes)} (${changes.length > 1 ? 'each asks first' : 'asks first'})`,
    });
  return lines;
}

/** Names for what changed, when the new version's manifest and tools are at hand. */
export interface ChangeNames {
  manifest?: Partial<Pick<ConchAppManifest, 'settings' | 'pages'>>;
  tools?: readonly Pick<ConchAppTool, 'name' | 'title'>[];
}

/**
 * How a new version differs, one sentence each, new reach first: it's what
 * someone must see before they press **Update**. Empty when nothing it can
 * reach or do has changed.
 */
export function describeChanges(changes: ConchAppChanges, names: ChangeNames = {}): string[] {
  const tool = (name: string) => {
    const found = names.tools?.find((t) => t.name === name);
    return found ? toolTitle(found) : toolTitle({ name, title: '' });
  };
  const setting = (key: string) =>
    names.manifest?.settings?.find((s) => s.key === key)?.label ?? key;
  const page = (id: string) => names.manifest?.pages?.find((p) => p.id === id)?.title ?? id;
  const out: string[] = [];
  // Your keys go with it to its new websites: said plainly, first.
  if (changes.reachesAdded.length)
    out.push(
      changes.carriesOver
        ? `Your saved settings will go with it, and it now also reaches ${and(changes.reachesAdded)}`
        : `Now also reaches ${and(changes.reachesAdded)}`,
    );
  if (changes.pageStateAdded) out.push('Now remembers page preferences on this computer');
  if (changes.queryCacheAdded)
    out.push('Now saves lookup results locally for quick loading and refresh');
  if (changes.toolsNowChange.length)
    out.push(
      `${list(changes.toolsNowChange.map(tool))} ${changes.toolsNowChange.length > 1 ? 'now make' : 'now makes'} changes`,
    );
  if (changes.settingsAdded.length)
    out.push(`Now needs from you: ${list(changes.settingsAdded.map(setting))}`);
  if (changes.toolsAdded.length) out.push(`New: ${list(changes.toolsAdded.map(tool))}`);
  if (changes.pagesAdded.length)
    out.push(
      `${changes.pagesAdded.length > 1 ? 'New pages' : 'A new page'}: ${list(changes.pagesAdded.map(page))}`,
    );
  if (changes.toolsRemoved.length) out.push(`No longer: ${list(changes.toolsRemoved.map(tool))}`);
  if (changes.reachesRemoved.length) out.push(`No longer reaches ${and(changes.reachesRemoved)}`);
  return out;
}

/**
 * Who an app is from, in a few words: "Made by you", "Signed by Ada
 * Lovelace", "From github.com/ada/plant-diary", "From a file". A signature
 * that doesn't hold, or a key using someone else's name, says so instead of
 * a name (ADR 0031).
 */
export function appSourceLine(
  source: ConchAppSource,
  signature: Pick<SkillSignature, 'state' | 'publisher' | 'lookalike'>,
): string {
  if (source.kind === 'made') {
    if (source.basedOn)
      return `Based on ${source.basedOn.name} ${appSourceLine(source.basedOn.source, { state: 'unsigned' }).replace(/^From/, 'from')}`;
    if (source.afterReading?.length)
      return `Made in a chat that read ${source.afterReading.slice(0, 2).join(' and ')}`;
    return 'Made by you';
  }
  if (signature.state === 'invalid') return 'Its signature doesn’t hold';
  if (signature.lookalike)
    return signature.publisher
      ? `Signed with a key that isn’t ${signature.publisher}’s`
      : 'Signed with a key you don’t know';
  if (signature.state !== 'unsigned' && signature.publisher)
    return `Signed by ${signature.publisher}`;
  switch (source.kind) {
    case 'github': {
      const path = source.path ?? '';
      let start = 0;
      let end = path.length;
      while (start < end && path[start] === '/') start++;
      while (end > start && path[end - 1] === '/') end--;
      return `From github.com/${source.owner}/${source.repo}${path ? `/${path.slice(start, end)}` : ''}`;
    }
    case 'link': {
      // The host alone: who it's from, without a path to read.
      const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#\s]+)/i.exec(source.url)?.[1];
      return host ? `From ${host.toLowerCase()}` : 'From a link';
    }
    case 'file':
      return 'From a file';
  }
}
