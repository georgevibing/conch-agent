import { isServerId, type Provider, type ProviderGroup } from '@conch/protocol';

/** The gallery's kinds, in the words a person sorts providers by. */
export const GROUP_WORDS: Record<ProviderGroup, string> = {
  subscription: 'Your plans',
  key: 'Pay as you go',
  local: 'On this computer',
  server: 'Your own servers',
};

/** How the gallery orders its kinds. */
export const GROUP_ORDER: readonly ProviderGroup[] = ['subscription', 'local', 'key', 'server'];

/** The tile that adds a server of your own. */
export const SERVER_TILE = {
  id: 'new-server',
  name: 'Another server',
  tagline: 'Any OpenAI-compatible address',
  description:
    'A model server you run yourself — llama.cpp, vLLM, Jan, LiteLLM — or a service with an OpenAI-compatible address. Give it a name, and its models join the picker.',
} as const;

/** The logo a provider wears: its id, or a server for one you added. */
export function brandOf(provider: Pick<Provider, 'id' | 'brand'>): string {
  return provider.brand ?? (isServerId(provider.id) ? 'server' : provider.id);
}

/**
 * Whether a provider is one of yours: working, given a key, the default, or
 * set up before (even while it needs you). The rest wait in the gallery.
 */
export function isYours(provider: Provider): boolean {
  return (
    provider.ready ||
    Boolean(provider.key) ||
    provider.active ||
    provider.connectedBefore ||
    provider.group === 'server' ||
    halfwayHere(provider)
  );
}

/**
 * A model on this computer whose app is already here — waiting for a model, or
 * stuck starting — is half set up: it stays in view, saying what's left.
 */
function halfwayHere({ local, status }: Provider): boolean {
  if (!local || status.state === 'checking' || status.state === 'ready') return false;
  return !(status.state === 'not-installed' && status.fix?.kind === 'install');
}

/**
 * The button on a provider that isn't working yet: what pressing it does,
 * the same in first run and in Settings.
 */
export function setupLabel(provider: Provider): string {
  const { state, fix } = provider.status;
  // Ollama's own page starts it when it's stuck; any other program here can only be looked at again.
  if (provider.local && (state !== 'error' || provider.id === 'ollama')) return 'Set up';
  if (fix?.kind === 'install') return 'Install';
  if (fix?.kind === 'update') return 'Update';
  if (state === 'not-installed') return 'How to install';
  if (state === 'error') return 'Try again';
  if (provider.connect === 'key') return 'Add a key';
  return 'Sign in';
}

/** The note under a tile: what it costs to start, or where it runs. */
export function noteOf(provider: Provider): string | undefined {
  if (provider.free) return provider.free;
  if (provider.status.state === 'not-installed' && provider.status.fix?.kind === 'install')
    return 'Conch installs it';
  if (provider.connect === 'program') return 'Sign in';
  return undefined;
}

/** Words a person might search a provider by, beyond its name. */
export function searchWords(provider: Provider): string {
  return [
    provider.name,
    provider.tagline,
    provider.description,
    provider.highlights.join(' '),
    GROUP_WORDS[provider.group],
    provider.free ?? '',
  ]
    .join(' ')
    .toLowerCase();
}
