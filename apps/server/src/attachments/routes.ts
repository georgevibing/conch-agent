import { createReadStream } from 'node:fs';

import { ATTACHMENT_LIMITS, UploadedAttachment, type Attachment } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AttachmentError, type AttachmentStore } from './store';

/** Types a browser may show in place. Everything else downloads. */
const MEDIA = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/webm',
]);

/** A header value as text, or undefined; never more than `max` characters. */
function header(value: string | string[] | undefined, max = 1024): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text && text.length <= max ? text : undefined;
}

function decoded(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** RFC 6266 / 5987: an ASCII fallback plus the real name, so no name can break the header. */
function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * How an attachment is served. It's someone's file, not our page: nothing in
 * it may run as Conch. Images, PDFs and media show in place; text is always
 * `text/plain` (an attached HTML file is shown as source, never rendered);
 * anything else downloads. Every response is sandboxed and `nosniff` (set
 * globally), so a browser can't be talked into treating it as something else.
 */
function serveAs(attachment: Attachment, download: boolean) {
  if (download) return { type: 'application/octet-stream', inline: false, frame: false };
  if (attachment.kind === 'image') return { type: attachment.mimeType, inline: true, frame: false };
  if (attachment.kind === 'text')
    return { type: 'text/plain; charset=utf-8', inline: true, frame: false };
  // The chat shows PDFs in a frame of its own; browsers won't render one inside a sandbox.
  if (attachment.mimeType === 'application/pdf')
    return { type: 'application/pdf', inline: true, frame: true };
  if (MEDIA.has(attachment.mimeType))
    return { type: attachment.mimeType, inline: true, frame: false };
  return { type: 'application/octet-stream', inline: false, frame: false };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AttachmentError) {
    const status = { 'too-large': 413, empty: 400, 'not-found': 404 }[error.code];
    return reply.code(status).send({ error: error.code, message: error.message });
  }
  throw error;
}

/**
 * `POST /api/attachments` takes the raw bytes of one file (never multipart,
 * never JSON-wrapped base64): `application/octet-stream` isn't a type a
 * cross-site form can send without a preflight, and the global Origin and
 * Fetch-Metadata checks already refuse other sites. The name travels in
 * `x-conch-name` (URI-encoded), the browser's guess at the type in
 * `x-conch-type`, and `x-conch-pasted: 1` marks a long paste.
 */
export function registerAttachmentRoutes(app: FastifyInstance, store: AttachmentStore): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: ATTACHMENT_LIMITS.maxBytes },
      (_request, body, done) => done(null, body),
    );
    scope.setErrorHandler((error: { code?: string; statusCode?: number }, _request, reply) => {
      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE')
        return reply.code(413).send({
          error: 'too-large',
          message: `That file is over ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB, the most Conch takes.`,
        });
      if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
        return reply
          .code(415)
          .send({ error: 'bad-request', message: 'Send the file as application/octet-stream.' });
      throw error;
    });

    scope.post(
      '/api/attachments',
      { bodyLimit: ATTACHMENT_LIMITS.maxBytes },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body))
          return reply
            .code(415)
            .send({ error: 'bad-request', message: 'Send the file as application/octet-stream.' });
        const pasted = header(request.headers['x-conch-pasted'], 1) === '1';
        const name = decoded(header(request.headers['x-conch-name'])) ?? 'file';
        try {
          const attachment = await store.save({
            name,
            bytes: request.body,
            claimedType: header(request.headers['x-conch-type'], 255),
            pasted,
          });
          return UploadedAttachment.parse({ attachment });
        } catch (error) {
          return sendError(reply, error);
        }
      },
    );
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    '/api/attachments/:id',
    async (request, reply) => {
      const found = await store.get(request.params.id);
      if (!found) return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
      const how = serveAs(found.attachment, request.query.download === '1');
      reply.headers({
        'content-type': how.type,
        'content-disposition': disposition(
          how.inline ? 'inline' : 'attachment',
          found.attachment.name,
        ),
        'content-security-policy': how.frame
          ? "default-src 'none'; frame-ancestors 'self'"
          : "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; frame-ancestors 'none'",
        ...(how.frame && { 'x-frame-options': 'SAMEORIGIN' }),
      });
      return reply.send(createReadStream(found.path));
    },
  );

  // Taking something off a draft frees it at once; sent attachments stay with their chat.
  app.delete<{ Params: { id: string } }>('/api/attachments/:id', async (request) => ({
    ok: await store.discard(request.params.id),
  }));
}
