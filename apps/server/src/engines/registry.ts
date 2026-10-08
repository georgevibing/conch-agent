/**
 * Every provider Conch knows by name, built in one place (ADR 0053). `Services`
 * builds them to run; the documentation builds them in an empty folder to read
 * what each one declares about itself. Servers you add are built one at a time
 * as you add them (`serverEngine`).
 */
import type { BuiltInEngineId, ServerConfig } from '@conch/protocol';

import { CloudService } from '../clouds/service';
import type { ProviderKeys } from '../providers/keys';
import type { SettingsStore } from '../settings/store';
import { ACP_AGENTS } from './acp/agents';
import { AcpEngine } from './acp/engine';
import { anthropicApiVariant, ApiEngine, ollamaVariant, openrouterVariant } from './api';
import { azureVariant, bedrockVariant, vertexVariant } from './api/clouds';
import { lmStudioVariant } from './api/lmstudio';
import type { OllamaLink } from './api/ollama';
import { ollamaCloudVariant } from './api/ollamaCloud';
import { OpenAiWire, type EndpointMemory } from './api/openai';
import { PRESETS, type Preset } from './api/presets';
import { defaultHome } from './api/session';
import { serverVariant } from './api/server';
import type { ApiVariant, FetchLike } from './api/types';
import { ClaudeCodeEngine } from './claude-code/engine';
import { CodexEngine } from './codex/engine';
import type { Engine } from './types';

export interface RegistryDeps {
  settings: SettingsStore;
  keys: ProviderKeys;
  home: string;
  /** Where Ollama is (the local model), shared with "On this computer". */
  local: OllamaLink;
  /** Say what was fixed on its own. */
  heal?: (message: string) => void;
  paths?: { claude?: string; codex?: string };
  fetch?: FetchLike;
  /** Your company's cloud accounts (ADR 0109); one that reads nothing until asked, when unset. */
  clouds?: CloudService;
}

/**
 * Which of a provider's addresses took its key, kept in settings. Read as
 * soon as settings have been, written each time a check finds a new one.
 */
export function endpointMemory(settings: SettingsStore, id: string): EndpointMemory {
  let known: string | undefined;
  void settings
    .get()
    .then((s) => {
      known ??= s.endpoints[id];
    })
    .catch(() => undefined);
  return {
    get: () => known,
    set: (endpoint) => {
      if (known === endpoint) return;
      known = endpoint;
      void settings.setEndpoint(id, endpoint).catch(() => undefined);
    },
  };
}

/** A preset model API, ready for `ApiEngine`. */
export function presetVariant(
  preset: Preset,
  deps: { home?: string; fetch?: FetchLike; memory?: EndpointMemory } = {},
): ApiVariant {
  return {
    id: preset.id,
    label: preset.label,
    docsUrl: preset.docsUrl,
    keyUrl: preset.keyUrl,
    canSignIn: false,
    wire: new OpenAiWire(preset, deps.fetch ?? globalThis.fetch, deps.memory),
    home: deps.home ?? defaultHome(),
  };
}

/** Every provider Conch knows by name (the test double is added by `Services`). */
export function builtInEngines(deps: RegistryDeps): Map<BuiltInEngineId, Engine> {
  const { settings, keys, home } = deps;
  const api = (variant: ApiVariant) => new ApiEngine(variant, settings, keys);
  const clouds = deps.clouds ?? new CloudService({ settings });
  const cloud = { clouds, home, ...(deps.fetch && { fetch: deps.fetch }) };
  const engines = new Map<BuiltInEngineId, Engine>([
    [
      'claude-code',
      new ClaudeCodeEngine(settings, keys, deps.paths?.claude, (m) => deps.heal?.(m), clouds),
    ],
    ['codex-cli', new CodexEngine(settings, keys, deps.paths?.codex)],
    // Codex CLI: Codex with its own tools, asking through Conch (ADR 0066).
    ['codex-agent', new CodexEngine(settings, keys, deps.paths?.codex, undefined, 'agent')],
    ['copilot', new AcpEngine(ACP_AGENTS.copilot, settings)],
    ['gemini-cli', new AcpEngine(ACP_AGENTS['gemini-cli'], settings)],
    ['grok', new AcpEngine(ACP_AGENTS.grok, settings)],
    ['ollama', api(ollamaVariant(deps.local, { home }))],
    ['lm-studio', api(lmStudioVariant({ home, ...(deps.heal && { heal: deps.heal }) }))],
    ['openrouter', api(openrouterVariant({ home }))],
    ['anthropic-api', api(anthropicApiVariant({ home }))],
  ]);
  for (const preset of PRESETS) {
    if (preset.id === 'ollama-cloud') continue;
    engines.set(
      preset.id,
      api(
        presetVariant(preset, {
          home,
          ...(deps.fetch && { fetch: deps.fetch }),
          memory: endpointMemory(settings, preset.id),
        }),
      ),
    );
  }
  engines.set('ollama-cloud', api(ollamaCloudVariant(deps.local, { home })));
  // Your company's cloud (ADR 0109).
  engines.set('bedrock', api(bedrockVariant(cloud)));
  engines.set('vertex', api(vertexVariant(cloud)));
  engines.set('azure-openai', api(azureVariant(cloud)));
  return engines;
}

/** A server you added, as a provider. */
export function serverEngine(
  config: ServerConfig,
  deps: Pick<RegistryDeps, 'settings' | 'keys' | 'home' | 'fetch'>,
): Engine {
  return new ApiEngine(
    serverVariant(config, { home: deps.home, ...(deps.fetch && { fetch: deps.fetch }) }),
    deps.settings,
    deps.keys,
  );
}
