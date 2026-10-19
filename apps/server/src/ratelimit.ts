import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface RouteBudget {
  /** Requests each key may start per window. */
  max: number;
  /** The window, in milliseconds. */
  timeWindow: number;
  /** Who is charged. Must not trust anything a client can rotate freely. */
  key: (request: FastifyRequest) => string;
  /** What a person reads, given the seconds to wait. */
  message: (seconds: number) => string;
}

/**
 * Charges every route registered after this resolves through `@fastify/rate-limit`
 * (the official plugin, which code scanning also recognises). Its hook runs at
 * the route's `onRequest`, after the server's own hooks and before the body is
 * parsed, so a request an earlier guard refused is never counted. Answers 429
 * with Retry-After and Conch's own error shape; no budget headers on success.
 */
export async function limitRoutes(app: FastifyInstance, budget: RouteBudget): Promise<void> {
  // Awaited: Fastify hands a route to the plugin only if it has loaded first.
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: budget.max,
    timeWindow: budget.timeWindow,
    cache: 10_000,
    keyGenerator: budget.key,
    addHeadersOnExceeding: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
    },
    addHeaders: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
      'retry-after': true,
    },
    errorResponseBuilder: (_request, context) => {
      const seconds = Math.max(1, Math.ceil(context.ttl / 1000));
      return {
        statusCode: 429,
        error: 'rate-limited',
        message: budget.message(seconds),
        retryAfter: seconds,
      };
    },
  });
}
