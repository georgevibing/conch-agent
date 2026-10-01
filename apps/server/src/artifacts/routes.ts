import { ARTIFACT_FILES, UpdateArtifactBody } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { isLoopbackAddress } from '../auth/network';
import { frameDocument, frameHeaders } from './frame';
import type { ArtifactService } from './service';
import { ArtifactError } from './store';

const STATUS = { 'not-found': 404, invalid: 400, 'too-big': 413 } as const;

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ArtifactError)
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
        const { artifact, n, content } = await artifacts.store.content(
          request.params.id,
          Number(request.params.n) || undefined,
        );
        if (artifact.kind !== 'html')
          return reply
            .code(400)
            .send({ error: 'bad-request', message: 'Only pages open in a frame.' });
        // A page that could send you elsewhere runs no code unless you said it may (`scripts=1`).
        const risky = artifact.versions.find((v) => v.n === n)?.navigates === true;
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

  app.post<{ Params: { id: string } }>('/api/artifacts/:id/refresh', async (request, reply) => {
    try {
      return await artifacts.refresh(request.params.id);
    } catch (error) {
      return fail(reply, error);
    }
  });
}
