/**
 * A server you run yourself, as a provider (ADR 0053): the shared chat adapter
 * pointed at your address, with the name you gave it.
 */
import type { ServerConfig } from '@conch/protocol';

import { keyCheckFor } from '../../providers/servers';
import { OpenAiWire } from './openai';
import { defaultHome } from './session';
import { ApiError, type ApiDeps, type ApiVariant } from './types';

/** Whether an address is this computer itself, so the server works offline and costs nothing. */
export function onThisComputer(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function serverVariant(config: ServerConfig, deps: ApiDeps = {}): ApiVariant {
  const check = keyCheckFor(config.url);
  const local = onThisComputer(config.url);
  return {
    id: config.id,
    label: config.name,
    docsUrl: config.url,
    keyUrl: config.url,
    canSignIn: false,
    keyOptional: true,
    local,
    ...(local && {
      where: 'You are a model running on this computer, on a server the user runs themselves.',
    }),
    wire: new OpenAiWire(
      {
        id: config.id,
        label: config.name,
        endpoints: [{ id: 'self', base: config.url }],
        key: 'optional',
        plainHttp: true,
        // Open models on your own server often think inside <think> tags.
        thinkTags: true,
        ...(check && {
          checkKey: async (context) => {
            const status = await context.status(check);
            if (status === 401 || status === 403)
              throw new ApiError(
                'auth',
                `${config.name} refused your key. Add a new one in Settings.`,
              );
          },
        }),
      },
      deps.fetch ?? globalThis.fetch,
    ),
    home: deps.home ?? defaultHome(),
  };
}
