/**
 * `POST /api/cards/send`: a picture of a card in the chat, sent to this
 * person's own chat app. The channels service and the attachment store stand
 * in for the real ones — what's under test is the guards, which are the whole
 * point of the route (ADR 0105).
 */
import type { Attachment } from '@conch/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelServiceError } from '../channels/service';
import { registerCardRoutes } from './routes';

const png: Attachment = {
  id: 'att_chart',
  name: 'Chart.png',
  mimeType: 'image/png',
  size: 4096,
  kind: 'image',
  width: 960,
  height: 520,
  createdAt: 1_760_000_000_000,
};

const notAPicture: Attachment = {
  ...png,
  id: 'att_notes',
  name: 'notes.txt',
  mimeType: 'text/plain',
  kind: 'text',
};

/** The store only ever admits an attachment to the chat it belongs to. */
const own = new Map<string, { attachment: Attachment; conversation: string }>([
  ['att_chart', { attachment: png, conversation: 'c_1' }],
  ['att_notes', { attachment: notAPicture, conversation: 'c_1' }],
  ['att_other', { attachment: { ...png, id: 'att_other' }, conversation: 'c_2' }],
]);

const sendable = vi.fn(async () => [
  { id: 'ch_1', kind: 'telegram' as const, name: 'Telegram', color: '#26A5E4' },
  { id: 'ch_2', kind: 'slack' as const, name: 'Slack', color: '#4A154B' },
]);
const messageOwner = vi.fn(async () => ({ app: 'Telegram', sent: ['Chart.png'], missed: [] }));

let app: FastifyInstance;

beforeEach(async () => {
  sendable.mockClear();
  messageOwner.mockClear();
  app = Fastify({ logger: false });
  registerCardRoutes(app, {
    channels: { sendable, messageOwner },
    attachments: {
      inConversation: async (id, conversationId) => {
        const found = own.get(id);
        return found && found.conversation === conversationId
          ? { attachment: found.attachment, path: `/tmp/${id}` }
          : undefined;
      },
    },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const send = (payload: object) => app.inject({ method: 'POST', url: '/api/cards/send', payload });

describe('GET /api/cards/apps', () => {
  it('lists the apps a card can be sent to, the last one written from first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cards/apps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      apps: [
        { id: 'ch_1', kind: 'telegram', name: 'Telegram', color: '#26A5E4' },
        { id: 'ch_2', kind: 'slack', name: 'Slack', color: '#4A154B' },
      ],
    });
  });

  it('says none rather than nothing when no app is connected', async () => {
    sendable.mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: '/api/cards/apps' });
    expect(res.json()).toEqual({ apps: [] });
  });
});

describe('POST /api/cards/send', () => {
  it('sends this chat’s picture to the named app, and says what went', async () => {
    const res = await send({
      conversationId: 'c_1',
      attachmentId: 'att_chart',
      caption: 'Berlin, the week ahead',
      app: 'Telegram',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ app: 'Telegram', sent: ['Chart.png'], missed: [] });
    expect(messageOwner).toHaveBeenCalledExactlyOnceWith('Berlin, the week ahead', {
      app: 'Telegram',
      attachments: ['att_chart'],
      conversationId: 'c_1',
    });
  });

  it('without an app, lets the service pick the one they wrote from last', async () => {
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_chart' });
    expect(res.statusCode).toBe(200);
    expect(messageOwner).toHaveBeenCalledExactlyOnceWith('', {
      attachments: ['att_chart'],
      conversationId: 'c_1',
    });
  });

  it('refuses another chat’s picture, and sends nothing', async () => {
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_other' });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/isn’t in this chat/);
    expect(messageOwner).not.toHaveBeenCalled();
  });

  it('refuses a picture that was never uploaded, and sends nothing', async () => {
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_nothing' });
    expect(res.statusCode).toBe(404);
    expect(messageOwner).not.toHaveBeenCalled();
  });

  it('sends only pictures this way', async () => {
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_notes' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Only a picture/);
    expect(messageOwner).not.toHaveBeenCalled();
  });

  it('takes no recipient from the body: only the owner’s own chat is reached', async () => {
    const res = await send({
      conversationId: 'c_1',
      attachmentId: 'att_chart',
      to: '+49 170 0000000',
      chatId: '998877',
      app: 'Telegram',
    });
    expect(res.statusCode).toBe(200);
    // Zod drops what isn't in the schema; nothing of it reaches the service.
    expect(messageOwner).toHaveBeenCalledExactlyOnceWith('', {
      app: 'Telegram',
      attachments: ['att_chart'],
      conversationId: 'c_1',
    });
  });

  it('refuses politely when the app isn’t connected', async () => {
    messageOwner.mockRejectedValueOnce(
      new ChannelServiceError(
        'unavailable',
        'Signal isn’t connected. The user can be reached on Telegram.',
      ),
    );
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_chart', app: 'Signal' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'unavailable',
      message: 'Signal isn’t connected. The user can be reached on Telegram.',
    });
  });

  it('refuses politely when no app is connected at all', async () => {
    messageOwner.mockRejectedValueOnce(
      new ChannelServiceError(
        'unavailable',
        'None of the user’s chat apps is connected right now.',
      ),
    );
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_chart' });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/None of the user’s chat apps/);
  });

  it('passes on a bad file id as the service named it', async () => {
    messageOwner.mockRejectedValueOnce(
      new ChannelServiceError('invalid', 'There’s no file “att_chart” in this chat.'),
    );
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_chart' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid');
  });

  it('lets a real failure be a real failure', async () => {
    messageOwner.mockRejectedValueOnce(new Error('the socket went away'));
    const res = await send({ conversationId: 'c_1', attachmentId: 'att_chart' });
    expect(res.statusCode).toBe(500);
  });

  it('caps the caption and checks the ids', async () => {
    const long = await send({
      conversationId: 'c_1',
      attachmentId: 'att_chart',
      caption: 'x'.repeat(401),
    });
    expect(long.statusCode).toBe(400);
    const bad = await send({ conversationId: '../../etc', attachmentId: 'att_chart' });
    expect(bad.statusCode).toBe(400);
    const none = await send({ attachmentId: 'att_chart' });
    expect(none.statusCode).toBe(400);
    expect(messageOwner).not.toHaveBeenCalled();
  });
});
