/**
 * Sending a card in the chat to a chat app (ADR 0105).
 *
 * A rich card — a forecast, a chart, a share price — is drawn in the browser,
 * so the browser is what makes the picture (`cardPng` in Nacre; the gateway's
 * own PNG path needs a headless browser and Conch doesn't require one). The
 * page uploads that PNG like any other attachment, and then asks here for it
 * to be sent.
 *
 * Sending a message to a person is an outward-facing action, so these are the
 * terms:
 *
 * - **It only ever reaches the owner of this Conch.** `channels.messageOwner`
 *   finds this person's own private chat with Conch in the app and writes
 *   there. There is no recipient in the request — no address, no handle, no
 *   phone number — so nothing in the chat, in a page it read or in a model's
 *   reply can redirect it. The worst a prompt injection could do with this
 *   route is write to the person it was already allowed to write to.
 * - **It only ever sends this chat's own picture.** The attachment must
 *   already belong to the conversation named in the body, which is only true
 *   of something the page uploaded and claimed. Another chat's attachment, or
 *   an id that was never uploaded, is refused before anything is sent.
 * - **It is never the model's doing.** The route is reached from a press on
 *   the card's own **Send** button, after a question naming the app. The
 *   assistant has no tool that calls it; when it wants to send a picture
 *   itself it uses `message_user` with a file it made, which is its own
 *   decision with its own words.
 * - **It says what it did.** The answer names the app and anything that
 *   couldn't go, so the card can show the truth rather than a hopeful tick.
 *
 * Authentication is the ordinary `/api` one: this computer, or a signed-in
 * approved device, with the Origin and Fetch-Metadata checks that apply to
 * every route (so no other site can post here). It needs no sudo step: it
 * grants nobody any reach, it only writes a line to a chat the person already
 * writes to.
 */
import { SendCardBody, SentCard, ShareApps } from '@conch/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { AttachmentStore } from '../attachments/store';
import { ChannelServiceError, type ChannelService } from '../channels/service';

export interface CardRouteDeps {
  channels: Pick<ChannelService, 'sendable' | 'messageOwner'>;
  attachments: Pick<AttachmentStore, 'inConversation'>;
}

const STATUS: Record<ChannelServiceError['code'], number> = {
  'not-found': 404,
  invalid: 400,
  unavailable: 409,
};

export function registerCardRoutes(app: FastifyInstance, deps: CardRouteDeps): void {
  /** The apps this card can be sent to: real, connected, most recent first. */
  app.get('/api/cards/apps', async () => ShareApps.parse({ apps: await deps.channels.sendable() }));

  app.post('/api/cards/send', async (request, reply: FastifyReply) => {
    const body = SendCardBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ error: 'bad-request', message: body.error.issues[0]?.message ?? 'Bad request.' });
    const { conversationId, attachmentId, caption, app: wanted } = body.data;

    // The picture has to be this chat's own. Checked here, before anything is
    // sent, so another chat's attachment can never leave the computer.
    const found = await deps.attachments.inConversation(attachmentId, conversationId);
    if (!found)
      return reply.code(404).send({
        error: 'not-found',
        message: 'That picture isn’t in this chat any more. Make it again and send it.',
      });
    if (found.attachment.kind !== 'image')
      return reply
        .code(400)
        .send({ error: 'bad-request', message: 'Only a picture of a card can be sent this way.' });

    try {
      const done = await deps.channels.messageOwner(caption ?? '', {
        ...(wanted && { app: wanted }),
        attachments: [attachmentId],
        conversationId,
      });
      return SentCard.parse({
        app: done.app,
        sent: done.sent ?? [],
        missed: done.missed ?? [],
      });
    } catch (error) {
      if (error instanceof ChannelServiceError)
        return reply.code(STATUS[error.code]).send({ error: error.code, message: error.message });
      throw error;
    }
  });
}
