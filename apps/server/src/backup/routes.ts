import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

import {
  BACKUP_LIMITS,
  BackupSettingsBody,
  checkPassword,
  CreateBackupBody,
  type CreatedBackup,
  RestoreBackupBody,
  type RestoreResult,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { disposition } from '../attachments/routes';
import { restart } from '../lib/lifecycle';
import type { Gatekeeper } from '../security';
import { BackupError } from './archive';
import { fileName, type BackupService } from './service';

const STATUS: Record<BackupError['code'], number> = {
  'not-backup': 400,
  damaged: 400,
  unsafe: 400,
  'too-big': 413,
  newer: 400,
  older: 400,
  'needs-passphrase': 400,
  'wrong-passphrase': 400,
  'weak-passphrase': 400,
  'local-only': 400,
  busy: 409,
  'not-found': 404,
  'no-space': 507,
};

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof BackupError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  // Never a path or a system error on the page: the log has the detail.
  reply.log.error({ err: (error as Error).message }, 'backup failed');
  return reply.code(500).send({
    error: 'internal',
    message:
      'Something went wrong with the backup. Try again, and if it keeps happening, restart Conch.',
  });
}

function parse<T extends z.ZodType>(schema: T, value: unknown, reply: FastifyReply) {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<T>;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

/**
 * Backups (ADR 0020). Everything is under `/api`, behind the gateway's host,
 * origin and sign-in checks. Restoring replaces what's here and brings back
 * sign-in, so it always needs a recent password or key (sudo mode); so does a
 * backup that carries your keys and sign-ins out of Conch.
 *
 * Uploads follow attachments (ADR 0017): raw `application/octet-stream`, a
 * type no cross-site form can send without a preflight. They're streamed to
 * disk and cut off at the size limit, never held in memory.
 */
export function registerBackupRoutes(
  app: FastifyInstance,
  backups: BackupService,
  gate: Gatekeeper,
): void {
  const verifyRequired = (request: FastifyRequest, reply: FastifyReply) => {
    if (gate.verified(request.access)) return false;
    void reply
      .code(403)
      .send({ error: 'verify-required', message: 'Confirm it’s you to make this change.' });
    return true;
  };
  const guarded = async <T>(reply: FastifyReply, task: () => Promise<T>) => {
    try {
      return await task();
    } catch (error) {
      return sendError(reply, error);
    }
  };

  app.get('/api/backups', () => backups.status());

  app.patch('/api/backups/settings', async (request, reply) => {
    const body = parse(BackupSettingsBody, request.body, reply);
    if (!body) return;
    return backups.setAutomatic(body.automatic);
  });

  app.post('/api/backups', async (request, reply) => {
    const body = parse(CreateBackupBody, request.body ?? {}, reply);
    if (!body) return;
    if (body.passphrase !== undefined) {
      // Your keys and sign-ins leaving Conch, even locked, is yours to confirm.
      if (verifyRequired(request, reply)) return;
      const check = checkPassword(body.passphrase);
      if (!check.ok)
        return reply.code(400).send({ error: 'weak-passphrase', message: check.message });
    }
    return guarded(reply, async (): Promise<CreatedBackup> => {
      const made = await backups.createExport({ chats: body.chats, passphrase: body.passphrase });
      return { id: made.id, name: fileName(made.createdAt), size: made.size };
    });
  });

  app.get<{ Params: { id: string } }>('/api/backups/:id', (request, reply) =>
    guarded(reply, () => backups.summary(request.params.id)),
  );

  /** What restoring it brings, read from its files, before anyone confirms. */
  app.get<{ Params: { id: string } }>('/api/backups/:id/preview', (request, reply) =>
    guarded(reply, () => backups.preview(request.params.id)),
  );

  app.get<{ Params: { id: string } }>('/api/backups/:id/download', (request, reply) =>
    guarded(reply, async () => {
      const summary = await backups.summary(request.params.id);
      if (!summary.downloadable)
        return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      reply.headers({
        'content-type': 'application/octet-stream',
        'content-disposition': disposition('attachment', fileName(summary.createdAt)),
        'content-length': String(summary.size),
      });
      return reply.send(createReadStream(backups.pathOf(summary.id)));
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/backups/:id', async (request) => ({
    ok: await backups.discard(request.params.id),
  }));

  void app.register(async (scope) => {
    // The body stays a stream: it goes to disk as it arrives.
    scope.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
      done(null, payload),
    );
    scope.post('/api/backups/upload', async (request, reply) => {
      const declared = Number(request.headers['content-length'] ?? 0);
      if (declared > BACKUP_LIMITS.maxArchiveBytes)
        return reply.code(413).send({
          error: 'too-big',
          message: 'That file is over 2 GB, too big to be a Conch backup.',
        });
      const body = request.body as Readable | undefined;
      if (!body || typeof (body as { pipe?: unknown }).pipe !== 'function')
        return reply
          .code(415)
          .send({ error: 'bad-request', message: 'Send the file as application/octet-stream.' });
      return guarded(reply, () =>
        backups.receive(body, { ...(declared > 0 && { size: declared }) }),
      );
    });
  });

  app.post<{ Params: { id: string } }>('/api/backups/:id/restore', async (request, reply) => {
    if (verifyRequired(request, reply)) return;
    const body = parse(RestoreBackupBody, request.body ?? {}, reply);
    if (!body) return;
    const session = request.access?.kind === 'session' ? request.access.session : undefined;
    return guarded(reply, async (): Promise<RestoreResult> => {
      await backups.restore(request.params.id, {
        passphrase: body.passphrase,
        skipSecrets: body.skipSecrets,
        keepSessionId: session?.id,
      });
      // Every store reads the restored files as it starts.
      if (restart()) return { restarting: true };
      return {
        restarting: false,
        message:
          'Your backup is ready to restore. Restart Conch to finish: stop it (Ctrl+C) and run pnpm start again.',
      };
    });
  });

  /** Forget a restore that's waiting for Conch to start again. */
  app.delete('/api/backups/pending', (_request, reply) =>
    guarded(reply, async () => ({ ok: await backups.cancelPending() })),
  );
}
