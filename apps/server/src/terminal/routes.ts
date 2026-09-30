import {
  CreateTerminalBody,
  TerminalLiveCommand,
  UpdateTerminalSettingsBody,
  type TerminalLiveEvent,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Gatekeeper } from '../security';
import type { Services } from '../services';
import { TerminalError, type Asker } from './service';
import type { TerminalWatcher } from './session';

/** Output waiting to be sent before the shell is paused (flow control). */
const CONGESTED_BYTES = 4 * 1024 * 1024;

const STATUS: Record<TerminalError['code'], number> = {
  off: 403,
  'remote-off': 403,
  'verify-required': 403,
  'not-found': 404,
  'too-many': 409,
  unavailable: 503,
};

/**
 * The terminal's routes (ADR 0015). All under `/api`, so Host, Origin, Fetch
 * Metadata and sign-in are checked like everything else. Attaching needs a
 * ticket from a POST, so no plain GET — and no link — ever opens a shell.
 */
export function registerTerminalRoutes(app: FastifyInstance, services: Services, gate: Gatekeeper) {
  const { terminal } = services;

  const askerOf = (request: FastifyRequest): Asker => {
    const access = request.access;
    return {
      local: gate.isLocal(request),
      verified: gate.verified(access),
      owner:
        access?.kind === 'session'
          ? `session:${access.session.id}`
          : access?.kind === 'bearer'
            ? `key:${access.keyId}`
            : 'local',
    };
  };

  const fail = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof TerminalError)) throw error;
    const code = error.code === 'verify-required' ? 'verify-required' : `terminal-${error.code}`;
    return reply.code(STATUS[error.code]).send({ error: code, message: error.message });
  };

  app.get('/api/terminal', (request) => terminal.status(askerOf(request)));

  app.patch('/api/terminal/settings', async (request, reply) => {
    const parsed = UpdateTerminalSettingsBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    }
    const asker = askerOf(request);
    // Letting other devices open shells is a trust decision; so is any change made from one.
    if ((parsed.data.allowRemote === true || !asker.local) && !asker.verified) {
      return reply
        .code(403)
        .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    }
    await terminal.updateSettings(parsed.data);
    return terminal.status(asker);
  });

  app.post('/api/terminal', async (request, reply) => {
    const parsed = CreateTerminalBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad-request', message: parsed.error.issues[0]?.message });
    }
    try {
      return reply.code(201).send(await terminal.create(parsed.data, askerOf(request)));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/terminal/:id/ticket', async (request, reply) => {
    try {
      return await terminal.ticket(request.params.id, askerOf(request));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/terminal/:id', (request, reply) => {
    if (!terminal.close(request.params.id)) {
      return reply.code(404).send({ error: 'not-found', message: 'That terminal has ended.' });
    }
    return { ok: true };
  });

  // ── Live ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { ticket?: string } }>(
    '/api/terminal/live',
    { websocket: true },
    (socket, request) => {
      const asker = askerOf(request);
      const ticket = typeof request.query.ticket === 'string' ? request.query.ticket : '';
      const session = ticket ? terminal.redeem(ticket, asker.owner) : undefined;
      if (!session) return socket.close(1008, 'Ask for a new ticket');
      const auth = request.access?.kind === 'session' ? request.access.session : undefined;
      const untrack = auth ? gate.track(auth.id, socket) : undefined;
      const watcher: TerminalWatcher = {
        send: (event: TerminalLiveEvent) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
        },
        output: (data) => {
          if (socket.readyState === socket.OPEN) socket.send(data, { binary: true });
        },
        congested: () => socket.bufferedAmount > CONGESTED_BYTES,
      };
      const unwatch = terminal.watch(session, watcher);
      socket.on('close', () => {
        untrack?.();
        unwatch();
      });
      let checked = 0;
      socket.on('message', async (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return;
        let json: unknown;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          return watcher.send({ type: 'error', message: 'Invalid JSON.' });
        }
        const command = TerminalLiveCommand.safeParse(json);
        if (!command.success) {
          return watcher.send({
            type: 'error',
            message: command.error.issues[0]?.message ?? 'Invalid.',
          });
        }
        // Still signed in? Checked at most once a second, so typing stays instant.
        if (Date.now() - checked > 1_000) {
          if (typeof (await gate.resolve(request)) !== 'object')
            return socket.close(4401, 'Signed out');
          checked = Date.now();
        }
        if (command.data.type === 'input') session.write(command.data.data);
        else session.resize(command.data.cols, command.data.rows);
      });
    },
  );
}
