import type { FastifyInstance, InjectOptions } from 'fastify';

import { hereCookieName } from '../auth/here';
import type { Services } from '../services';

/**
 * Ask for a request without this computer's proof: a browser Conch didn't
 * open, a proxy that hides itself, or another account here. Only the test
 * helper reads it; the gateway never sees it.
 */
export const NOT_HERE = 'x-test-not-here';

const cookies = new WeakMap<FastifyInstance, (port: number) => string>();

/**
 * The app as a browser opened from Conch sees it (ADR 0063): every injected
 * request carries the cookie a one-time code gives, for Conch's port. A
 * request that sets its own host, address or proxy headers is still judged by
 * those: the cookie only counts on a request that looks local. Give
 * `[NOT_HERE]: '1'` for one without it.
 */
export function onThisComputer<T extends FastifyInstance>(app: T, services: Services): T {
  const cookie = (port: number) => `${hereCookieName(port)}=${services.here.cookie()}`;
  cookies.set(app, cookie);
  const inject = app.inject.bind(app);
  const wrapped = (options?: string | InjectOptions) => {
    if (options === undefined) return inject();
    const given: InjectOptions = typeof options === 'string' ? { url: options } : options;
    const {
      [NOT_HERE]: notHere,
      cookie: theirs,
      ...rest
    } = (given.headers ?? {}) as Record<string, string | string[] | number | undefined>;
    const jar = [theirs, notHere ? undefined : cookie(services.config.CONCH_PORT)]
      .filter((part) => part !== undefined && part !== '')
      .join('; ');
    return inject({ ...given, headers: { ...rest, ...(jar && { cookie: jar }) } });
  };
  Object.defineProperty(app, 'inject', { value: wrapped, configurable: true, writable: true });
  return app;
}

/** For a real WebSocket to an app from `onThisComputer`, listening: the cookie for its port. */
export function hereInit(app: FastifyInstance): { headers: Record<string, string> } {
  const cookie = cookies.get(app);
  const address = app.server.address();
  if (!cookie || !address || typeof address === 'string')
    throw new Error('Wrap the app with onThisComputer, and listen, first.');
  return { headers: { cookie: cookie(address.port) } };
}
