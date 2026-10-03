/**
 * LM Studio — the models you already have there, run on this computer (ADR 0053).
 *
 * Details that are easy to get wrong, from LM Studio's own docs and source
 * (lmstudio-ai/lms, lmstudio-js; October 2026):
 *  - its home is the path in `~/.lmstudio-home-pointer` when that exists, else
 *    `~/.cache/lm-studio` when that exists, else `~/.lmstudio`;
 *  - its server isn't always on 1234: `lms server start` reuses the last port,
 *    kept in `<home>/.internal/http-server-config.json`;
 *  - `GET /lmstudio-greeting` → `{"lmstudio": true}` is how its own tools know
 *    it's LM Studio answering;
 *  - `/api/v1/models` (0.4) says what each model is — `type` llm or embedding,
 *    `capabilities.vision`, `trained_for_tool_use`, `reasoning` — and
 *    `loaded_instances` says whether it's in memory; 0.3 has `/api/v0/models`
 *    with `type` llm, vlm or embeddings and `state`;
 *  - a model that isn't loaded is loaded when asked (Just-in-Time, on by
 *    default), and the OpenAI-style stream says nothing while that happens;
 *  - thinking arrives as `reasoning_content` or `reasoning`, depending on the model;
 *  - an API token (0.4, off by default) is `sk-lm-` + 8 + `:` + 20 characters.
 *
 * Everything stays on this computer: the address is always loopback.
 */
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { EngineStatus } from '@conch/protocol';
import { z } from 'zod';

import { presentSync, run } from '../../lib/proc';
import { OpenAiWire, type ChatPreset } from './openai';
import { defaultHome } from './session';
import type { ApiDeps, ApiVariant, FetchLike, WireEvent, WireRequest } from './types';

export const LM_STUDIO_LABEL = 'LM Studio';
const DEFAULT_PORT = 1234;
const LOOK_MS = 1_500;

/** Where LM Studio keeps itself, the way its own tools find it. Read, never written. */
export async function lmStudioHome(home = homedir()): Promise<string> {
  try {
    const pointer = (await readFile(join(home, '.lmstudio-home-pointer'), 'utf8')).trim();
    if (pointer) return pointer;
  } catch {
    /* No pointer: the usual places. */
  }
  const cache = join(home, '.cache', 'lm-studio');
  return presentSync(cache) ? cache : join(home, '.lmstudio');
}

const Location = z.object({ path: z.string() }).passthrough();
const ServerConfig = z.object({ port: z.number().int().min(1).max(65535) }).passthrough();

/** The LM Studio app (or its headless daemon) this computer has, if any. */
export async function lmStudioInstall(home?: string): Promise<string | undefined> {
  const root = home ?? (await lmStudioHome());
  for (const file of ['app-install-location.json', 'llmster-install-location.json']) {
    try {
      const parsed = Location.safeParse(
        JSON.parse(await readFile(join(root, '.internal', file), 'utf8')),
      );
      if (parsed.success && presentSync(parsed.data.path)) return parsed.data.path;
    } catch {
      /* Not this one. */
    }
  }
  if (platform() === 'darwin') {
    for (const app of [
      '/Applications/LM Studio.app',
      join(homedir(), 'Applications', 'LM Studio.app'),
    ])
      if (presentSync(app)) return app;
  }
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    const exe = join(local, 'Programs', 'LM Studio', 'LM Studio.exe');
    if (presentSync(exe)) return exe;
  }
  return undefined;
}

/** The port LM Studio's server last used; 1234 when it never said. */
export async function lmStudioPort(home?: string): Promise<number> {
  const root = home ?? (await lmStudioHome());
  try {
    const parsed = ServerConfig.safeParse(
      JSON.parse(await readFile(join(root, '.internal', 'http-server-config.json'), 'utf8')),
    );
    if (parsed.success) return parsed.data.port;
  } catch {
    /* Never started from here. */
  }
  return DEFAULT_PORT;
}

/** The `lms` command, which LM Studio puts in its home. */
export function lmsPath(home: string): string {
  return join(home, 'bin', platform() === 'win32' ? 'lms.exe' : 'lms');
}

/** What the rest of Conch gives LM Studio: a heal note, and fetch for tests. */
export interface LmStudioDeps extends ApiDeps {
  /** Say what was fixed, in "Fixed on its own". */
  heal?: (message: string) => void;
  /** Where LM Studio's home is; tests give a folder of their own. */
  lmHome?: string;
  /** Start LM Studio's server; tests pretend. */
  startServer?: (home: string) => Promise<boolean>;
}

async function startWithLms(home: string): Promise<boolean> {
  const lms = lmsPath(home);
  if (!presentSync(lms)) return false;
  // With no port it reuses the last one; it starts LM Studio itself if it isn't running.
  const result = await run(lms, ['server', 'start'], { timeout: 30_000 });
  return result.code === 0;
}

/** LM Studio as a provider, ready for `services.ts`. */
export function lmStudioVariant(deps: LmStudioDeps = {}): ApiVariant {
  const fetchImpl: FetchLike = deps.fetch ?? globalThis.fetch;
  let port = DEFAULT_PORT;
  const base = () => `http://127.0.0.1:${port}`;
  /** Models in memory right now, from the last list. */
  const loaded = new Set<string>();
  const names = new Map<string, string>();

  const look = async (path: string, init: RequestInit = {}) => {
    try {
      return await fetchImpl(`${base()}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(LOOK_MS),
      });
    } catch {
      return undefined;
    }
  };
  const greets = async () => {
    const response = await look('/lmstudio-greeting');
    if (!response?.ok) return false;
    try {
      return ((await response.json()) as { lmstudio?: unknown }).lmstudio === true;
    } catch {
      return false;
    }
  };

  const preset: ChatPreset = {
    id: 'lm-studio',
    label: LM_STUDIO_LABEL,
    get endpoints() {
      return [{ id: 'local', base: `${base()}/v1` }];
    },
    key: 'optional',
    plainHttp: true,
    thinkTags: true,
    listModels: async (context) => {
      const read = async (path: string) => {
        try {
          return await context.get(`${base()}${path}`);
        } catch {
          return undefined;
        }
      };
      const v1 = await read('/api/v1/models');
      const list =
        v1 && typeof v1 === 'object' && Array.isArray((v1 as { models?: unknown }).models)
          ? (v1 as { models: unknown[] }).models
          : await (async () => {
              const v0 = await read('/api/v0/models');
              return v0 && typeof v0 === 'object' && Array.isArray((v0 as { data?: unknown }).data)
                ? (v0 as { data: unknown[] }).data
                : undefined;
            })();
      if (!list) return [];
      loaded.clear();
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const model = entry as Record<string, unknown>;
        const id = String(model.key ?? model.id ?? '');
        if (typeof model.display_name === 'string') names.set(id, model.display_name);
        if (
          (Array.isArray(model.loaded_instances) && model.loaded_instances.length > 0) ||
          model.state === 'loaded'
        )
          loaded.add(id);
      }
      return list;
    },
    // LM Studio gives every model tool use, natively or through its own prompt.
    facts: () => ({ tools: true }),
  };

  class LmStudioWire extends OpenAiWire {
    override async *stream(request: WireRequest): AsyncIterable<WireEvent> {
      if (!loaded.has(request.model))
        yield {
          type: 'notice',
          code: 'loading',
          message: `Loading ${names.get(request.model) ?? request.model} into memory — the first answer takes a moment.`,
        };
      yield* super.stream(request);
    }
  }
  const wire = new LmStudioWire(preset, fetchImpl);

  const status = async (key?: string): Promise<EngineStatus> => {
    const home = deps.lmHome ?? (await lmStudioHome());
    port = await lmStudioPort(home);
    const baseStatus = {
      engine: 'lm-studio' as const,
      label: LM_STUDIO_LABEL,
      install: [],
      docsUrl: 'https://lmstudio.ai/docs',
      canSignIn: false,
      checkedAt: Date.now(),
    };
    let up = await greets();
    if (!up) {
      const installed = await lmStudioInstall(home);
      if (!installed && !presentSync(lmsPath(home)))
        return {
          ...baseStatus,
          state: 'not-installed',
          fix: { need: 'lm-studio', kind: 'install' },
          message: 'LM Studio isn’t on this computer. Conch can install it for you.',
        };
      // Fix it before asking: start its server, the way its own `lms` does.
      if (await (deps.startServer ?? startWithLms)(home).catch(() => false)) {
        port = await lmStudioPort(home);
        up = await greets();
        if (up) deps.heal?.('Started LM Studio’s server so its models could answer.');
      }
      if (!up)
        return {
          ...baseStatus,
          state: 'error',
          executablePath: installed,
          message:
            'LM Studio’s server is off. Open LM Studio and turn on its server in the Developer tab.',
        };
    }
    const probe = await look(
      '/v1/models',
      key ? { headers: { authorization: `Bearer ${key}` } } : {},
    );
    if (probe?.status === 401 || probe?.status === 403)
      return {
        ...baseStatus,
        state: 'signed-out',
        message:
          'LM Studio asks for a key. Create one in LM Studio → Developer → Server Settings → Manage Tokens, and paste it here.',
      };
    const models = await wire.models(key ? { key } : {}).catch(() => []);
    if (!models.length)
      return {
        ...baseStatus,
        state: 'not-installed',
        message: 'Download a model in LM Studio, and it’s ready here.',
      };
    const first = models[0]?.info.label ?? '';
    return {
      ...baseStatus,
      state: 'ready',
      auth: {
        method: 'other',
        description: `${first}${models.length > 1 ? ` and ${models.length - 1} more` : ''} · works offline`,
      },
    };
  };

  return {
    id: 'lm-studio',
    label: LM_STUDIO_LABEL,
    docsUrl: 'https://lmstudio.ai/docs',
    keyUrl: 'https://lmstudio.ai/docs/developer/core/authentication',
    canSignIn: false,
    keyOptional: true,
    local: true,
    where:
      'You are a model running on this computer, through LM Studio: private, and it works without the internet.',
    status,
    wire,
    home: deps.home ?? defaultHome(),
  };
}
