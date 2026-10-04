import {
  AnswerVaultRequestBody,
  BreachCheckResult,
  VaultLockSettingsBody,
  VaultLockState,
  VaultPasswordBody,
  ImportBody,
  ImportPreview,
  PatchVaultItemBody,
  PasswordHistory,
  PurgeBody,
  Revealed,
  RevealRequest,
  SaveVaultItemBody,
  TotpCode,
  TotpRequest,
  UnlockSourceBody,
  VaultCopyOutBody,
  VaultCopyOutResult,
  VaultIdsBody,
  VaultItemDetail,
  VaultList,
  VaultSource,
  VaultSourceId,
  KeePassDatabase,
  VaultSourcePatch,
  VaultSyncPatch,
  VaultTransferBody,
  VaultTransferJob,
  VaultTransferPreview,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Access, Gatekeeper } from '../security';
import { VaultCryptoError } from './crypto';
import { findDatabases } from './keepass';
import { VaultError, type VaultService } from './service';
import { VaultIsLocked, VaultLockedError } from './store';

/**
 * Seeing a secret from another device needs a sign-in from the last five
 * minutes (ADR 0025): tighter than other sensitive changes, because a value
 * once seen can't be taken back.
 */
export const REVEAL_WINDOW_MS = 5 * 60 * 1000;

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  void reply.code(400).send({ error: 'bad-request', message: result.error.issues[0]?.message });
  return undefined;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof VaultError) {
    const status = {
      'not-found': 404,
      invalid: 400,
      'read-only': 409,
      unavailable: 503,
      refused: 403,
    }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof VaultIsLocked)
    return reply.code(423).send({ error: 'locked', message: error.message });
  if (error instanceof VaultLockedError || error instanceof VaultCryptoError)
    return reply.code(503).send({ error: 'unavailable', message: error.message });
  throw error;
}

/** Recent enough for this purpose. A request from this computer always is. */
function recent(access: Access | undefined, windowMs: number): boolean {
  if (!access) return false;
  if (access.kind !== 'session') return true;
  return Date.now() - access.session.verifiedAt < windowMs;
}

/** Who's asking, for the reveal limit: a device signed in from elsewhere. Unset on this computer. */
function who(access: Access | undefined): string | undefined {
  if (!access || access.kind === 'local') return undefined;
  return access.kind === 'session' ? `session:${access.session.id}` : `key:${access.keyId}`;
}

export function registerVaultRoutes(
  app: FastifyInstance,
  vault: VaultService,
  gate: Gatekeeper,
): void {
  const verify = (request: FastifyRequest, reply: FastifyReply, windowMs?: number) => {
    const ok =
      windowMs === undefined ? gate.verified(request.access) : recent(request.access, windowMs);
    if (ok) return true;
    void reply.code(403).send({
      error: 'verify-required',
      message: 'Confirm it’s you to see your passwords from this device.',
    });
    return false;
  };
  const guarded = async <T>(reply: FastifyReply, task: () => Promise<T>) => {
    try {
      return await task();
    } catch (error) {
      return sendError(reply, error);
    }
  };

  // `?look=1`: the Passwords page itself. Only then may a manager that asks the
  // person something (1Password's approval) be read; the sidebar, Apps and ⌘K
  // ask without it, and never raise a prompt in another app.
  app.get<{ Querystring: { look?: string } }>('/api/vault', (request, reply) =>
    guarded(reply, async () =>
      VaultList.parse(await vault.list({ looking: request.query.look === '1' })),
    ),
  );

  app.get<{ Params: { id: string } }>('/api/vault/items/:id', (request, reply) =>
    guarded(reply, async () => VaultItemDetail.parse(await vault.detail(request.params.id))),
  );

  app.post('/api/vault/items', async (request, reply) => {
    const body = parse(SaveVaultItemBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => VaultItemDetail.parse(await vault.create(body)));
  });

  app.put<{ Params: { id: string } }>('/api/vault/items/:id', async (request, reply) => {
    const body = parse(SaveVaultItemBody, request.body, reply);
    if (!body) return;
    // Changing a password can lock someone out of a site: a recent sign-in, as for any sensitive change.
    if (!verify(request, reply)) return;
    return guarded(reply, async () =>
      VaultItemDetail.parse(await vault.update(request.params.id, body)),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/vault/items/:id', async (request, reply) => {
    const body = parse(PatchVaultItemBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => {
      await vault.patch(request.params.id, body);
      return { ok: true };
    });
  });

  app.post<{ Params: { id: string } }>('/api/vault/items/:id/reveal', async (request, reply) => {
    const body = parse(RevealRequest, request.body, reply);
    if (!body) return;
    if (!verify(request, reply, REVEAL_WINDOW_MS)) return;
    return guarded(reply, async () =>
      Revealed.parse({
        value: await vault.reveal(
          request.params.id,
          body.fieldId,
          who(request.access),
          body.copy ? 'copied' : 'revealed',
        ),
      }),
    );
  });

  app.post<{ Params: { id: string } }>('/api/vault/items/:id/totp', async (request, reply) => {
    const body = parse(TotpRequest, request.body ?? {}, reply);
    if (!body) return;
    if (!verify(request, reply, REVEAL_WINDOW_MS)) return;
    return guarded(reply, async () =>
      TotpCode.parse(await vault.totp(request.params.id, body.fieldId, who(request.access))),
    );
  });

  app.get<{ Params: { id: string } }>('/api/vault/items/:id/history', async (request, reply) => {
    if (!verify(request, reply, REVEAL_WINDOW_MS)) return;
    return guarded(reply, async () =>
      PasswordHistory.parse(await vault.history(request.params.id)),
    );
  });

  app.post('/api/vault/trash', async (request, reply) => {
    const body = parse(VaultIdsBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => {
      await vault.trash(body.ids);
      return { ok: true };
    });
  });

  app.post('/api/vault/restore', async (request, reply) => {
    const body = parse(VaultIdsBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => {
      await vault.restore(body.ids);
      return { ok: true };
    });
  });

  app.post('/api/vault/purge', async (request, reply) => {
    const body = parse(PurgeBody, request.body ?? {}, reply);
    if (!body) return;
    if (!verify(request, reply)) return;
    return guarded(reply, async () => ({ removed: await vault.purge(body.ids) }));
  });

  // An import file can be a few megabytes of CSV.
  app.post('/api/vault/import', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const body = parse(ImportBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => ImportPreview.parse(await vault.import(body)));
  });

  // Every password in the clear, as a file: the most sensitive thing Conch can do.
  app.post('/api/vault/export', async (request, reply) => {
    if (!verify(request, reply, REVEAL_WINDOW_MS)) return;
    return guarded(reply, async () => {
      const csv = await vault.exportCsv();
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="Conch passwords.csv"')
        .send(csv);
    });
  });

  app.post('/api/vault/breaches', (_request, reply) =>
    guarded(reply, async () => BreachCheckResult.parse(await vault.checkBreaches())),
  );

  // ── The lock ──────────────────────────────────────────────────────────
  app.post('/api/vault/unlock', async (request, reply) => {
    const body = parse(VaultPasswordBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => {
      await vault.unlock(body.password);
      return { ok: true };
    });
  });

  app.post('/api/vault/lock', (_request, reply) =>
    guarded(reply, async () => {
      await vault.lock();
      return { ok: true };
    }),
  );

  // Turning the lock on or off is a sensitive change.
  app.patch('/api/vault/lock', async (request, reply) => {
    const body = parse(VaultLockSettingsBody, request.body, reply);
    if (!body) return;
    if (body.enabled !== undefined && !verify(request, reply)) return;
    return guarded(reply, async () =>
      VaultLockState.parse({
        ...(await vault.setLock(body)),
        autoLockMinutes: (await vault.settings()).autoLockMinutes,
      }),
    );
  });

  // ── Answering a card in the chat ──────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/vault/requests/:id', async (request, reply) => {
    const body = parse(AnswerVaultRequestBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => ({ itemId: await vault.answer(request.params.id, body) }));
  });

  app.post<{ Params: { id: string } }>('/api/vault/requests/:id/decline', async (request) => {
    vault.decline(request.params.id);
    return { ok: true };
  });

  const sourceId = (reply: FastifyReply, id: string) => {
    const parsed = VaultSourceId.exclude(['conch']).safeParse(id);
    if (parsed.success) return parsed.data;
    void reply
      .code(404)
      .send({ error: 'not-found', message: 'There’s no password manager by that name.' });
    return undefined;
  };

  app.patch<{ Params: { id: string } }>('/api/vault/sources/:id', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    const body = id && parse(VaultSourcePatch, request.body, reply);
    if (!id || !body) return;
    return guarded(reply, async () => z.array(VaultSource).parse(await vault.setSource(id, body)));
  });

  app.post<{ Params: { id: string } }>('/api/vault/sources/:id/unlock', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    const body = id && parse(UnlockSourceBody, request.body, reply);
    if (!id || !body) return;
    if (!verify(request, reply)) return;
    return guarded(reply, async () =>
      z.array(VaultSource).parse(await vault.unlockSource(id, body.password, body.remember)),
    );
  });

  app.post<{ Params: { id: string } }>('/api/vault/sources/:id/lock', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    if (!id) return;
    await vault.lockSource(id);
    return { ok: true };
  });

  // KeePassXC databases on this computer, so nobody types a path. Names and paths only.
  app.get('/api/vault/sources/keepassxc/databases', async (request) => {
    if (request.access?.kind !== 'local') return [];
    return z.array(KeePassDatabase).parse(await findDatabases());
  });

  // ── Moving in: copying a manager's items into Conch's vault ───────────
  // Copying writes every item it brings: a recent sign-in, as for any sensitive change.
  app.post<{ Params: { id: string } }>(
    '/api/vault/sources/:id/transfer',
    async (request, reply) => {
      const id = sourceId(reply, request.params.id);
      const body = id && parse(VaultTransferBody, request.body ?? {}, reply);
      if (!id || !body) return;
      if (id === 'system')
        return reply.code(404).send({ error: 'not-found', message: 'Nothing to copy from there.' });
      if (!body.commit)
        return guarded(reply, async () =>
          VaultTransferPreview.parse(await vault.transferPreview(id, body.ids)),
        );
      if (!verify(request, reply)) return;
      return guarded(reply, async () =>
        VaultTransferJob.parse(
          await vault.transfer(id, {
            ...(body.ids && { ids: body.ids }),
            skipDuplicates: body.skipDuplicates,
            keepSynced: body.keepSynced,
          }),
        ),
      );
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/vault/transfers/:jobId', (request, reply) =>
    guarded(reply, async () => VaultTransferJob.parse(vault.transferJob(request.params.jobId))),
  );

  app.post<{ Params: { jobId: string } }>('/api/vault/transfers/:jobId/cancel', async (request) => {
    vault.cancelTransfer(request.params.jobId);
    return { ok: true };
  });

  // ── Copy to: Conch's own items, made as new items in another manager (ADR 0062) ──
  // It sends passwords to another program: a sign-in from the last five minutes, as for
  // an export, and from another device each request counts towards its reveals.
  app.post<{ Params: { id: string } }>('/api/vault/sources/:id/copy', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    const body = id && parse(VaultCopyOutBody, request.body ?? {}, reply);
    if (!id || !body) return;
    if (id === 'system')
      return reply.code(404).send({ error: 'not-found', message: 'Nothing can be copied there.' });
    if (!verify(request, reply, REVEAL_WINDOW_MS)) return;
    return guarded(reply, async () =>
      VaultCopyOutResult.parse(
        await vault.copyOut(id, {
          ids: body.ids,
          ...(body.place && { place: body.place }),
          skipDuplicates: body.skipDuplicates,
          who: who(request.access),
        }),
      ),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/vault/sources/:id/sync', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    const body = id && parse(VaultSyncPatch, request.body, reply);
    if (!id || !body) return;
    if (body.enabled && !verify(request, reply)) return;
    return guarded(reply, async () =>
      z.array(VaultSource).parse(await vault.setSync(id, body.enabled)),
    );
  });

  app.post<{ Params: { id: string } }>('/api/vault/sources/:id/sync', async (request, reply) => {
    const id = sourceId(reply, request.params.id);
    if (!id) return;
    // It runs on; the list follows it through `vault.changed`.
    void vault.syncDue(id, { force: true, interactive: true }).catch(() => undefined);
    return guarded(reply, async () => z.array(VaultSource).parse(await vault.sourceStatus()));
  });

  // ── Passkeys ──────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string; passkeyId: string } }>(
    '/api/vault/items/:id/passkeys/:passkeyId',
    async (request, reply) => {
      if (!verify(request, reply)) return;
      return guarded(reply, async () => {
        await vault.removePasskey(request.params.id, request.params.passkeyId);
        return { ok: true };
      });
    },
  );
}
