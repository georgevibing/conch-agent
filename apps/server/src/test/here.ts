import type { FastifyInstance, InjectOptions } from 'fastify';

import { HERE_HEADER } from '../auth/here';
import type { Services } from '../services';

/**
 * The app as a program on this computer sees it (ADR 0063): every injected
 * request carries this computer's key in `X-Conch-Here`, as the launchers, the
 * desktop app and `pnpm conch open` do. A request that sets its own host,
 * address or proxy headers is still judged by those: the key only counts on a
 * request that looks local.
 *
 * To send a request without the key (a browser not opened from Conch, or
 * another account on this computer), give `x-conch-here: ''`.
 */
const keys = new WeakMap<FastifyInstance, () => string>();

/** For a real WebSocket to an app from `onThisComputer`: its key, as a program sends it. */
export function hereInit(app: FastifyInstance): { headers: Record<string, string> } {
  const key = keys.get(app);
  if (!key) throw new Error('Wrap the app with onThisComputer first.');
  return { headers: { [HERE_HEADER]: key() } };
}

export function onThisComputer<T extends FastifyInstance>(app: T, services: Services): T {
  keys.set(app, () => services.here.key());
  const inject = app.inject.bind(app);
  const wrapped = (options?: string | InjectOptions) => {
    if (options === undefined) return inject();
    const given: InjectOptions = typeof options === 'string' ? { url: options } : options;
    const { [HERE_HEADER]: givenKey, ...rest } = (given.headers ?? {}) as Record<
      string,
      string | string[] | number | undefined
    >;
    // `''` sends none; anything else is sent as given; nothing said sends this computer's key.
    const key = givenKey === undefined ? services.here.key() : givenKey;
    return inject({ ...given, headers: key === '' ? rest : { ...rest, [HERE_HEADER]: key } });
  };
  Object.defineProperty(app, 'inject', { value: wrapped, configurable: true, writable: true });
  return app;
}
