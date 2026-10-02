import {
  ApproveLiveDataBody,
  ARTIFACT_FILES,
  ArtifactDraftBody,
  LiveDataRequest,
  SaveArtifactVersionBody,
  UpdateArtifactBody,
} from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { isLoopbackAddress } from '../auth/network';
import { frameDocument, frameHeaders, navigates } from './frame';
import { LiveDataError } from './live';
import type { ArtifactService } from './service';
import { ArtifactError } from './store';

/** A version in an address: a number, or `draft` for the page you're editing. */
const versionRef = (n: string): number | 'draft' | undefined =>
  n === 'draft' ? 'draft' : /^\d{1,6}$/.test(n) && Number(n) > 0 ? Number(n) : undefined;

const STATUS = { 'not-found': 404, invalid: 400, 'too-big': 413, conflict: 409 } as const;

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ArtifactError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  if (error instanceof LiveDataError)
    return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
  throw error;
}

/** A file name a person would keep: "Budget planner.html". */
const fileName = (title: string, ext: string) => {
  const plain = [...title]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
    .join('');
  return `${plain.replace(/\s+/g, ' ').trim().slice(0, 80) || 'artifact'}.${ext}`;
};

/**
 * Show me (ADR 0034). Under `/api`, behind the gateway's host, origin and
 * sign-in checks. The page itself (`…/frame`) is served with its own, much
 * stricter headers: sealed, no network, framed only by Conch.
 */
export function registerArtifactRoutes(app: FastifyInstance, artifacts: ArtifactService): void {
  app.get('/api/artifacts', async () => ({ artifacts: await artifacts.store.list() }));

  app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (request, reply) => {
    try {
      return await artifacts.store.get(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { id: string; n: string } }>(
    '/api/artifacts/:id/versions/:n',
    async (request, reply) => {
      try {
        const { artifact, n, content } = await artifacts.store.content(
          request.params.id,
          Number(request.params.n) || undefined,
        );
        return { artifactId: artifact.id, n, content };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string; n: string }; Querystring: { scripts?: string; theme?: string } }>(
    '/api/artifacts/:id/versions/:n/frame',
    async (request, reply) => {
      try {
        // The page you're editing is served exactly like a saved one (ADR 0039).
        const draft = request.params.n === 'draft';
        const { artifact, n, content } = draft
          ? {
              artifact: await artifacts.store.get(request.params.id),
              n: 0,
              content: artifacts.draftContent(request.params.id),
            }
          : await artifacts.store.content(request.params.id, Number(request.params.n) || undefined);
        if (artifact.kind !== 'html')
          return reply
            .code(400)
            .send({ error: 'bad-request', message: 'Only pages open in a frame.' });
        if (content === undefined)
          return reply.code(404).send({ error: 'not-found', message: 'Nothing is being edited.' });
        // A page that could send you elsewhere runs no code unless you said it may (`scripts=1`).
        const risky = draft
          ? navigates(content)
          : artifact.versions.find((v) => v.n === n)?.navigates === true;
        const scripts = request.query.scripts === '1' || (request.query.scripts !== '0' && !risky);
        // The page Conch is shown on: https too behind a local TLS proxy (`tailscale serve`).
        const proxied =
          request.headers['x-forwarded-proto'] === 'https' &&
          isLoopbackAddress(request.socket.remoteAddress);
        const proto = request.protocol === 'https' || proxied ? 'https' : 'http';
        const parentOrigin = `${proto}://${request.headers.host ?? 'localhost'}`;
        reply.headers(frameHeaders(scripts));
        return reply.send(
          frameDocument(content, {
            title: artifact.title,
            theme: request.query.theme === 'dark' ? 'dark' : 'light',
            parentOrigin,
          }),
        );
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string; n: string } }>(
    '/api/artifacts/:id/versions/:n/download',
    async (request, reply) => {
      try {
        const { artifact, content } = await artifacts.store.content(
          request.params.id,
          Number(request.params.n) || undefined,
        );
        const file = ARTIFACT_FILES[artifact.kind];
        const name = fileName(artifact.title, file.ext);
        // Always a download, never shown here: and if it were, still sealed.
        reply.headers({
          'content-type': `${file.type}; charset=utf-8`,
          'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'content-security-policy': "default-src 'none'; sandbox",
          'x-content-type-options': 'nosniff',
        });
        return reply.send(content);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.patch<{ Params: { id: string } }>('/api/artifacts/:id', async (request, reply) => {
    const body = UpdateArtifactBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    try {
      return await artifacts.patch(request.params.id, body.data);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/artifacts/:id', async (request, reply) => {
    try {
      await artifacts.remove(request.params.id);
      return { ok: true };
    } catch (error) {
      return fail(reply, error);
    }
  });

  // Edit by hand (ADR 0039): a new version, marked as yours.
  app.post<{ Params: { id: string } }>('/api/artifacts/:id/versions', async (request, reply) => {
    const body = SaveArtifactVersionBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    try {
      return await artifacts.edit(request.params.id, body.data);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put<{ Params: { id: string } }>('/api/artifacts/:id/draft', async (request, reply) => {
    const body = ArtifactDraftBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    try {
      return await artifacts.draft(request.params.id, body.data.content);
    } catch (error) {
      return fail(reply, error);
    }
  });

  // Live data (ADR 0039). Only Conch's own page calls these, for a page in its
  // sealed frame: the frame itself has no network, and its opaque origin is
  // refused here like any other site.
  app.get('/api/live-data', async () => {
    const all = await artifacts.store.list();
    const approvals = (await artifacts.live.access.list())
      .map((a) => ({ ...a, title: all.find((p) => p.id === a.artifactId)?.title ?? '' }))
      .filter((a) => a.title)
      .sort((a, b) => b.at - a.at);
    return { approvals };
  });

  app.get<{ Params: { id: string; n: string } }>(
    '/api/artifacts/:id/versions/:n/live-data',
    async (request, reply) => {
      const version = versionRef(request.params.n);
      if (!version)
        return reply.code(404).send({ error: 'not-found', message: 'No such version.' });
      try {
        return await artifacts.live.info(request.params.id, version);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string; n: string } }>(
    '/api/artifacts/:id/versions/:n/live-data',
    async (request, reply) => {
      const version = versionRef(request.params.n);
      if (!version)
        return reply.code(404).send({ error: 'not-found', message: 'No such version.' });
      const body = LiveDataRequest.safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ error: 'bad-request', message: 'That isn’t a request a page can make.' });
      try {
        return await artifacts.live.read(request.params.id, version, body.data);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/artifacts/:id/live-data', async (request, reply) => {
    const body = ApproveLiveDataBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'bad-request', message: body.error.issues[0]?.message });
    try {
      return await artifacts.live.approve(
        request.params.id,
        body.data.version,
        body.data.host,
        body.data.local,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string; host: string } }>(
    '/api/artifacts/:id/live-data/:host',
    async (request) => {
      await artifacts.live.revoke(request.params.id, request.params.host);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/artifacts/:id/refresh', async (request, reply) => {
    try {
      return await artifacts.refresh(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });
}
