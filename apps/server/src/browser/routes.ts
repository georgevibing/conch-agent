import { readFile } from 'node:fs/promises';

import {
  BrowserLiveCommand,
  Id,
  SetBrowserBackendBody,
  UpdateBrowserSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import type { Services } from '../services';
import { BrowserProblemError } from './runtime';
import type { Watcher } from './tab';

/** A site as stored: a registrable domain, a host or an IP. */
const SITE = /^[a-z0-9.:[\]-]{1,253}$/i;
/** A thumbnail id (see `BrowserService.saveShot`). */
const SHOT = /^[a-z0-9]{8,40}$/;
/** Frames waiting to go out before new ones are dropped (latest wins). */
const MAX_BUFFERED = 1_500_000;

/**
 * The browser's REST routes and its live view (ADR 0014). All under `/api`, so
 * the gateway's host, origin and sign-in checks cover them like everything else.
 */
export function registerBrowserRoutes(app: FastifyInstance, services: Services, gate: Gatekeeper) {
  const { browser } = services;

  const verifyRequired = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return false;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return true;
  };

  app.get('/api/browser', () => browser.status());

  app.patch('/api/browser/settings', async (request, reply) => {
    const parsed = UpdateBrowserSettingsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    }
    // Opening this computer and your network to the agent's browser is a trust decision.
    if (parsed.data.allowLocal === true && verifyRequired(request, reply)) return;
    await browser.updateSettings(parsed.data);
    return browser.status();
  });

  /**
   * Where the browser runs (ADR 0080). Your own Chrome, or a browser elsewhere
   * that sees what it browses, is a trust decision: it needs a recent sign-in.
   * Going back to Conch's own never does.
   */
  app.put('/api/browser/backend', async (request, reply) => {
    const parsed = SetBrowserBackendBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    }
    if (parsed.data.kind !== 'local' && verifyRequired(request, reply)) return;
    try {
      return await browser.setBackend(parsed.data);
    } catch (error) {
      if (error instanceof BrowserProblemError)
        return reply.code(400).send({ error: 'bad-request', message: error.problem.message });
      throw error;
    }
  });

  /** Forget a saved cloud key or browser address. */
  app.delete<{ Params: { kind: string } }>('/api/browser/backend/:kind', async (request, reply) => {
    const kind = z.enum(['browserbase', 'steel', 'cdp']).safeParse(request.params.kind);
    if (!kind.success) return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
    return browser.forgetBackend(kind.data);
  });

  app.delete<{ Params: { site: string } }>('/api/browser/sites/:site', async (request, reply) => {
    const site = decodeURIComponent(request.params.site);
    if (!SITE.test(site))
      return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
    await browser.revokeSite(site);
    return browser.status();
  });

  app.post('/api/browser/repair', () => browser.repair());

  /** Take the wheel or hand it back from outside the live view (the transcript's "I’m done"). */
  app.post<{ Params: { id: string } }>('/api/browser/:id/control', async (request, reply) => {
    const body = z.object({ to: z.enum(['user', 'agent']) }).safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: 'Say who drives.' });
    const tab = browser.tabIfOpen(request.params.id);
    if (!tab)
      return reply
        .code(404)
        .send({ error: 'not-found', message: 'No browser tab is open for this chat.' });
    tab.setControl(body.data.to === 'user' ? 'user' : 'idle');
    return { ok: true };
  });

  /** Sign out of everything: the browser's profile is deleted. */
  app.post('/api/browser/wipe', () => browser.wipe());

  app.get<{ Params: { id: string; shot: string } }>(
    '/api/browser/shots/:id/:shot',
    async (request, reply) => {
      const { id, shot } = request.params;
      if (!SHOT.test(shot) || !(await browser.shotExists(id, shot))) {
        return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      }
      const jpeg = await readFile(browser.shotPath(id, shot));
      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(jpeg);
    },
  );

  // ── Live view ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { conversationId?: string } }>(
    '/api/browser/live',
    { websocket: true },
    async (socket, request) => {
      const conversationId = Id.safeParse(request.query.conversationId);
      if (!conversationId.success) return socket.close(1008, 'Unknown conversation');
      try {
        await services.conversations.detail(conversationId.data);
      } catch {
        return socket.close(1008, 'Unknown conversation');
      }
      const id = conversationId.data;
      // Signing this device out (or its session expiring) closes the view.
      const session = request.access?.kind === 'session' ? request.access.session : undefined;
      const untrack = session ? gate.track(session.id, socket) : undefined;
      const watcher: Watcher = {
        visible: false,
        send: (event) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
        },
        frame: (jpeg) => {
          if (socket.readyState !== socket.OPEN || socket.bufferedAmount > MAX_BUFFERED) return;
          socket.send(jpeg, { binary: true });
        },
      };
      const unwatch = browser.watch(id, watcher);
      socket.on('close', () => {
        untrack?.();
        unwatch();
      });
      socket.on('message', async (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return;
        let json: unknown;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          return watcher.send({ type: 'error', message: 'Invalid JSON.' });
        }
        const command = BrowserLiveCommand.safeParse(json);
        if (!command.success) {
          return watcher.send({
            type: 'error',
            message: command.error.issues[0]?.message ?? 'Invalid command.',
          });
        }
        if (typeof (await gate.resolve(request)) !== 'object')
          return socket.close(4401, 'Signed out');
        try {
          await browser.command(id, watcher, command.data);
        } catch (error) {
          watcher.send({
            type: 'error',
            message:
              error instanceof BrowserProblemError
                ? error.problem.message
                : (String((error as Error).message).split('\n')[0] ?? 'That didn’t work.'),
          });
        }
      });
    },
  );
}
