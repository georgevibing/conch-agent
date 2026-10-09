/**
 * Apps you make, share and add, over HTTP (ADR 0061). Under `/api`, behind
 * the gateway's host, origin and sign-in checks — so a sealed page, whose
 * origin is `null`, is refused here like any other site. A page's own frame
 * (`…/frame`) is served with the artifact seal's headers.
 *
 * Trust: adding or updating an app someone else made, and going back to an
 * earlier version, change what code runs for you. A sealed app is less than
 * a program (no files, no programs, only the websites on its card), but a
 * stranger's app is still code, so those ask that it's you (a recent
 * password or key), as installing a program does. An app made in this
 * chat is added with one press: the person watched it being made, and the
 * card says what it can do. Publishing signs with your key and puts it in
 * public, so it asks too.
 */
import {
  type AppPartTest,
  type AppPartValues,
  TestAppPartBody,
  AcceptAppOfferBody,
  AppId,
  AppCallBody,
  ApplyUpdateBody,
  AppSettingsBody,
  DeclineAppOfferBody,
  Id,
  InstallAppBody,
  madeHere,
  PreviewAppBody,
  RollbackAppBody,
  type ServerEvent,
  UpdateConchAppBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { isLoopbackAddress } from '../auth/network';
import { frameHeaders, navigates } from '../artifacts/frame';
import { ConchAppError, type ConchAppService } from './service';

const STATUS = {
  'not-found': 404,
  invalid: 400,
  changed: 409,
  conflict: 409,
  unavailable: 503,
  'too-big': 413,
} as const;

/** A file a page can be: a `.conchapp` of up to 10 MB, as base64, with room for the JSON. */
const PREVIEW_BODY_LIMIT = 15 * 1024 * 1024;

export interface ConchAppRouteHelpers {
  /** False when the person confirmed it's them recently; else it answers 403 and is true. */
  verifyRequired: (request: FastifyRequest, reply: FastifyReply) => boolean;
  emit: (event: ServerEvent) => void;
  /**
   * An app's provider and chat app (ADR 0122): the card's live test, and
   * keeping what was typed into it once the app is in (`extensions/service.ts`).
   */
  parts?: {
    test(
      ref: { conversationId: string; offerId: string } | { packageId: string; appId: string },
      body: TestAppPartBody,
    ): Promise<AppPartTest>;
    apply(appId: string, values: AppPartValues | undefined): Promise<string | undefined>;
  };
}

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

async function guarded<T>(reply: FastifyReply, task: () => Promise<T>) {
  try {
    return await task();
  } catch (error) {
    if (error instanceof ConchAppError)
      return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
    throw error;
  }
}

/** The origin Conch is shown from: https too behind a local TLS proxy. */
function parentOrigin(request: FastifyRequest): string {
  const proxied =
    request.headers['x-forwarded-proto'] === 'https' &&
    isLoopbackAddress(request.socket.remoteAddress);
  const proto = request.protocol === 'https' || proxied ? 'https' : 'http';
  return `${proto}://${request.headers.host ?? 'localhost'}`;
}

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

export function registerConchAppRoutes(
  app: FastifyInstance,
  service: ConchAppService,
  helpers: ConchAppRouteHelpers,
): void {
  const { verifyRequired } = helpers;
  const changed = () => helpers.emit({ type: 'conch-apps.changed' });

  app.get('/api/conch-apps', async (_request, reply) => {
    noStore(reply);
    return { apps: await service.list() };
  });

  app.get('/api/conch-apps/community', async (request, reply) => {
    const q = (request.query as { q?: unknown }).q;
    noStore(reply);
    return service.community(typeof q === 'string' ? q : '');
  });

  app.post('/api/conch-apps/preview', { bodyLimit: PREVIEW_BODY_LIMIT }, async (request, reply) => {
    const body = parse(PreviewAppBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () => noStore(reply).send(await service.preview(body)));
  });

  // The system's Open dialog shows on the computer Conch runs on, never across the network.
  app.post('/api/conch-apps/pick', async (request, reply) => {
    if (request.access?.kind !== 'local')
      return reply.code(403).send({
        error: 'not-here',
        message:
          'The Open dialog shows on the computer Conch runs on. Choose the file there, or drop it on Apps.',
      });
    return guarded(reply, async () => {
      const preview = await service.preview({ pick: true });
      return noStore(reply).send(preview ?? { cancelled: true });
    });
  });

  app.post('/api/conch-apps/install', async (request, reply) => {
    const body = parse(InstallAppBody, request.body, reply);
    if (!body) return;
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () => {
      const added = await service.install(body);
      changed();
      // Its provider's key, its chat app's fields: kept by Conch with its own (ADR 0122).
      const partProblem = await helpers.parts?.apply(added.id, body.parts);
      return partProblem ? { ...added, partProblem } : added;
    });
  });

  // **Test it** on a preview (ADR 0122): the files shown, sealed, with what was typed for the test.
  app.post<{ Params: { packageId: string; appId: string } }>(
    '/api/conch-apps/packages/:packageId/:appId/test',
    async (request, reply) => {
      const body = parse(TestAppPartBody, request.body, reply);
      if (!body) return;
      if (!helpers.parts || !Id.safeParse(request.params.packageId).success)
        return reply.code(404).send({ error: 'not-found', message: 'Look at the link again.' });
      if (!AppId.safeParse(request.params.appId).success)
        return reply.code(404).send({ error: 'not-found', message: 'Look at the link again.' });
      // A stranger's code, run with your key: the same trust decision as adding it.
      if (verifyRequired(request, reply)) return;
      return guarded(reply, async () =>
        noStore(reply).send(
          await helpers.parts?.test(
            { packageId: request.params.packageId, appId: request.params.appId },
            body,
          ),
        ),
      );
    },
  );

  // **Test it** on a card in a chat (ADR 0122).
  app.post<{ Params: { offerId: string } }>(
    '/api/conch-apps/offers/:offerId/test',
    async (request, reply) => {
      const body = parse(TestAppPartBody, request.body, reply);
      if (!body) return;
      const conversationId = body.conversationId ?? '';
      if (
        !helpers.parts ||
        !Id.safeParse(request.params.offerId).success ||
        !Id.safeParse(conversationId).success
      )
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That wasn’t offered in this chat.' });
      return guarded(reply, async () => {
        const offer = await service.offerIn(conversationId, request.params.offerId);
        const outside = offer.from === 'package' || !madeHere(offer.source);
        if (outside && verifyRequired(request, reply)) return reply;
        return noStore(reply).send(
          await helpers.parts?.test({ conversationId, offerId: request.params.offerId }, body),
        );
      });
    },
  );

  app.post<{ Params: { offerId: string } }>(
    '/api/conch-apps/offers/:offerId/accept',
    async (request, reply) => {
      const body = parse(AcceptAppOfferBody, request.body, reply);
      if (!body) return;
      if (
        !Id.safeParse(request.params.offerId).success ||
        !Id.safeParse(body.conversationId).success
      )
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That wasn’t offered in this chat.' });
      return guarded(reply, async () => {
        // Something someone else made is a trust decision; what was made in this chat isn't.
        const offer = await service.offerIn(body.conversationId, request.params.offerId);
        // So is one made in a chat that read something from outside, or a change to a stranger's app.
        const outside = offer.from === 'package' || !madeHere(offer.source);
        if (outside && offer.state === 'ready' && verifyRequired(request, reply)) return reply;
        const added = await service.acceptOffer(request.params.offerId, body);
        changed();
        // Its provider's key, its chat app's fields: kept by Conch with its own (ADR 0122).
        const partProblem = await helpers.parts?.apply(added.id, body.parts);
        return partProblem ? { ...added, partProblem } : added;
      });
    },
  );

  app.post<{ Params: { offerId: string } }>(
    '/api/conch-apps/offers/:offerId/decline',
    async (request, reply) => {
      const body = parse(DeclineAppOfferBody, request.body, reply);
      if (!body) return;
      if (
        !Id.safeParse(request.params.offerId).success ||
        !Id.safeParse(body.conversationId).success
      )
        return reply
          .code(404)
          .send({ error: 'not-found', message: 'That wasn’t offered in this chat.' });
      return guarded(reply, async () => {
        await service.declineOffer(request.params.offerId, body);
        return { ok: true };
      });
    },
  );

  app.get<{ Params: { id: string } }>('/api/conch-apps/:id', (request, reply) =>
    guarded(reply, async () => noStore(reply).send(await service.get(request.params.id))),
  );

  app.patch<{ Params: { id: string } }>('/api/conch-apps/:id', async (request, reply) => {
    const body = parse(UpdateConchAppBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () =>
      body.pinned === undefined
        ? service.get(request.params.id)
        : service.setPinned(request.params.id, body.pinned),
    );
  });

  app.delete<{ Params: { id: string }; Querystring: { keepData?: string } }>(
    '/api/conch-apps/:id',
    (request, reply) =>
      guarded(reply, async () => {
        await service.remove(request.params.id, { keepData: request.query.keepData === '1' });
        return { ok: true };
      }),
  );

  // A secret typed here is kept sealed and never sent back: the answer says only which are saved.
  app.patch<{ Params: { id: string } }>('/api/conch-apps/:id/settings', async (request, reply) => {
    const body = parse(AppSettingsBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () =>
      noStore(reply).send(await service.setSettings(request.params.id, body.values)),
    );
  });

  app.get<{ Params: { id: string } }>('/api/conch-apps/:id/update', (request, reply) =>
    guarded(reply, async () => noStore(reply).send(await service.updatePreview(request.params.id))),
  );

  // The press carries the hash of the version the person looked at: nothing else is installed.
  app.post<{ Params: { id: string } }>('/api/conch-apps/:id/update', async (request, reply) => {
    const body = parse(ApplyUpdateBody, request.body, reply);
    if (!body) return;
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () => {
      const updated = await service.applyUpdate(request.params.id, body.hash);
      changed();
      return updated;
    });
  });

  app.post<{ Params: { id: string } }>('/api/conch-apps/:id/rollback', async (request, reply) => {
    const body = parse(RollbackAppBody, request.body, reply);
    if (!body) return;
    if (verifyRequired(request, reply)) return;
    return guarded(reply, () => service.rollback(request.params.id, body.version));
  });

  // An app you made is signed with your key on the way out, so it asks that it's you, like publishing.
  app.get<{ Params: { id: string } }>('/api/conch-apps/:id/export', (request, reply) => {
    if (verifyRequired(request, reply)) return reply;
    return guarded(reply, async () => {
      const file = await service.exportFile(request.params.id);
      // Always a download, never shown here.
      reply.headers({
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${file.name}"`,
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      return reply.send(file.bytes);
    });
  });

  app.get<{ Params: { id: string } }>('/api/conch-apps/:id/publish', (request, reply) =>
    guarded(reply, async () => noStore(reply).send(await service.publishState(request.params.id))),
  );

  app.post<{ Params: { id: string } }>('/api/conch-apps/:id/publish', async (request, reply) => {
    if (verifyRequired(request, reply)) return;
    return guarded(reply, async () =>
      noStore(reply).send(await service.publish(request.params.id)),
    );
  });

  // ── Pictures (ADR 0090) ─────────────────────────────────────────────────
  //
  // An app's picture is someone else's bytes: served only after they read as
  // the PNG, JPEG or WebP their name says, with that type and nothing else,
  // never sniffed, sandboxed, and only to Conch's own pages. The address
  // carries the app's hash (`?v=`), so a new version is a new address.

  type Served = { name: string; type: string; bytes: Buffer } | undefined;
  const picture = async (reply: FastifyReply, find: () => Promise<Served> | Served) =>
    guarded(reply, async () => {
      const found = await find();
      if (!found)
        return noStore(reply)
          .code(404)
          .send({ error: 'not-found', message: 'This app has no picture.' });
      reply.headers({
        'content-type': found.type,
        'content-disposition': `inline; filename="${found.name}"`,
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'private, max-age=86400',
      });
      return reply.send(found.bytes);
    });

  app.get<{ Params: { id: string } }>('/api/conch-apps/:id/icon', (request, reply) =>
    picture(reply, () => service.appPicture(request.params.id)),
  );

  app.get<{ Params: { id: string } }>('/api/conch-apps/:id/update/icon', (request, reply) =>
    picture(reply, () =>
      AppId.safeParse(request.params.id).success
        ? service.updatePicture(request.params.id)
        : undefined,
    ),
  );

  app.get<{ Params: { draftId: string } }>(
    '/api/conch-apps/drafts/:draftId/icon',
    (request, reply) =>
      picture(reply, () =>
        Id.safeParse(request.params.draftId).success
          ? service.draftPicture(request.params.draftId)
          : undefined,
      ),
  );

  app.get<{ Params: { packageId: string; appId: string } }>(
    '/api/conch-apps/packages/:packageId/:appId/icon',
    (request, reply) =>
      picture(reply, () =>
        Id.safeParse(request.params.packageId).success &&
        AppId.safeParse(request.params.appId).success
          ? service.packagePicture(request.params.packageId, request.params.appId)
          : undefined,
      ),
  );

  // ── Pages ───────────────────────────────────────────────────────────────

  interface FrameQuery {
    theme?: string;
    accent?: string;
    scripts?: string;
  }
  const frame = async (
    request: FastifyRequest<{ Querystring: FrameQuery }>,
    reply: FastifyReply,
    ref: { appId: string } | { draftId: string },
    pageId: string,
  ) =>
    guarded(reply, async () => {
      const { document, content } = await service.pageDocument(ref, pageId, {
        theme: request.query.theme === 'dark' ? 'dark' : 'light',
        ...(typeof request.query.accent === 'string' && { accent: request.query.accent }),
        parentOrigin: parentOrigin(request),
      });
      // A page that could send you elsewhere runs no code unless you said it may (`scripts=1`).
      const scripts =
        request.query.scripts === '1' || (request.query.scripts !== '0' && !navigates(content));
      reply.headers({
        ...frameHeaders(scripts),
        'content-disposition': 'inline; filename="page.html"',
      });
      return reply.send(document);
    });

  app.get<{ Params: { id: string; page: string }; Querystring: FrameQuery }>(
    '/api/conch-apps/:id/pages/:page/frame',
    (request, reply) => frame(request, reply, { appId: request.params.id }, request.params.page),
  );

  app.get<{ Params: { draftId: string; page: string }; Querystring: FrameQuery }>(
    '/api/conch-apps/drafts/:draftId/pages/:page/frame',
    (request, reply) =>
      frame(request, reply, { draftId: request.params.draftId }, request.params.page),
  );

  app.post<{ Params: { id: string } }>('/api/conch-apps/:id/call', async (request, reply) => {
    const body = parse(AppCallBody, request.body, reply);
    if (!body) return;
    return guarded(reply, async () =>
      noStore(reply).send(
        await service.callFromPage(
          { appId: request.params.id },
          body.tool,
          body.input,
          body.confirmed,
        ),
      ),
    );
  });

  app.post<{ Params: { draftId: string } }>(
    '/api/conch-apps/drafts/:draftId/call',
    async (request, reply) => {
      const body = parse(AppCallBody, request.body, reply);
      if (!body) return;
      return guarded(reply, async () =>
        noStore(reply).send(
          await service.callFromPage(
            { draftId: request.params.draftId },
            body.tool,
            body.input,
            body.confirmed,
          ),
        ),
      );
    },
  );
}
