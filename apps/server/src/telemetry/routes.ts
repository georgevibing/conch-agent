/**
 * Settings → Dashboards (ADR 0119), and the page Prometheus reads.
 *
 * `/api/dashboards…` sits behind the gateway's host, origin and sign-in checks
 * like every `/api` route. Changing where Conch's numbers go, or letting the
 * words of chats go with them, sends something out of Conch: from another
 * device that needs a sign-in from the last ten minutes (`verified`), as
 * allowing a step that matters does (ADR 0108). The assistant has no tool for
 * any of it, and the files are protected from its own (`lib/protect.ts`).
 *
 * `GET /metrics` answers only once a person turned it on, and only to:
 *
 * - a scraper with the scrape token (`Authorization: Bearer conch_scrape_…`),
 *   compared in constant time, failures counted like sign-ins;
 * - or, when the person chose “this computer only”, a program on this
 *   computer: a loopback connection, a loopback name and no proxy in between;
 * - or someone already signed in to Conch (a browser opening it to look).
 *
 * Off, it's a 404, as though it weren't there.
 */
import { ScrapeTokenResult, TelemetryUpdate } from '@conch/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import { grafanaJson } from './grafana';
import type { TelemetryService } from './service';
import { scrapeConfig } from './service';
import { SCRAPE_PREFIX } from './store';

export function registerTelemetryRoutes(
  app: FastifyInstance,
  telemetry: TelemetryService,
  gate: Gatekeeper,
  verified: (request: FastifyRequest) => Promise<boolean>,
): void {
  const where = (request: FastifyRequest) => ({
    host: request.headers.host ?? 'localhost:4317',
    https: gate.isSecure(request) && request.protocol === 'https',
  });

  app.get('/api/dashboards', async () => telemetry.status());

  app.put('/api/dashboards', async (request, reply) => {
    const body = TelemetryUpdate.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({
        error: 'bad-request',
        message: body.error.issues[0]?.message ?? 'That change doesn’t read.',
      });
    const reaches =
      body.data.key !== undefined ||
      body.data.content === true ||
      body.data.otlp?.destination !== undefined ||
      body.data.otlp?.endpoint !== undefined ||
      body.data.otlp?.on === true ||
      body.data.prometheus?.on === true ||
      body.data.prometheus?.access !== undefined;
    if (reaches && !(await verified(request)))
      return reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you first: this sends Conch’s numbers somewhere new.',
      });
    return telemetry.update(body.data);
  });

  app.get('/api/dashboards/preview', async () => telemetry.preview());

  app.post('/api/dashboards/test', async () => telemetry.test());

  app.post('/api/dashboards/token', async (request, reply) => {
    if (!(await verified(request)))
      return reply.code(403).send({
        error: 'verify-required',
        message: 'Confirm it’s you first: a scrape token reads Conch’s numbers.',
      });
    return ScrapeTokenResult.parse(await telemetry.newScrapeToken(where(request)));
  });

  // A Grafana dashboard for these numbers, to import (Dashboards → New → Import).
  app.get('/api/dashboards/grafana', async (_request, reply) =>
    reply
      .header('content-disposition', 'attachment; filename="conch-grafana.json"')
      .type('application/json; charset=utf-8')
      .send(grafanaJson()),
  );

  // The scrape config without a token in it, for copying again later.
  app.get('/api/dashboards/scrape-config', async (request) => ({
    config: scrapeConfig(where(request)),
  }));

  app.get('/metrics', async (request, reply) => {
    const access = await telemetry.scrapeAccess();
    if (!access) return reply.code(404).type('text/plain; charset=utf-8').send('Not found.\n');
    const refuse = (status: number, words: string) => {
      if (status === 401) reply.header('www-authenticate', 'Bearer realm="conch"');
      return reply.code(status).type('text/plain; charset=utf-8').send(`${words}\n`);
    };
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const client = gate.clientKey(request);
    let allowed = false;
    if (bearer?.startsWith(SCRAPE_PREFIX)) {
      if (gate.limiter.retryAfter(client, false) > 0)
        return refuse(429, 'Too many wrong tokens. Wait a minute.');
      allowed = await telemetry.store.checkScrapeToken(bearer);
      if (!allowed) gate.limiter.fail(client);
    } else if (access.access === 'this-computer' && !bearer) {
      allowed = gate.looksLocal(request);
      if (!allowed) return refuse(403, 'Only programs on this computer can read these numbers.');
    }
    if (!allowed) {
      const signedIn = await gate.resolve(request);
      allowed = typeof signedIn === 'object';
    }
    if (!allowed)
      return refuse(
        401,
        'This needs the scrape token. Make one in Settings → Dashboards, then send it as a Bearer token.',
      );
    const page = await telemetry.prometheus(request.headers.accept);
    return reply.header('cache-control', 'no-store').type(page.type).send(page.body);
  });
}
