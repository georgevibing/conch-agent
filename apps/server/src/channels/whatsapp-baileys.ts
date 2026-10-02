/**
 * The real WhatsApp connection, through Baileys (`@whiskeysockets/baileys`,
 * ADR 0043): the open-source library that speaks WhatsApp Web's protocol as
 * a linked device. It's loaded only when a WhatsApp channel connects, so
 * Conch without one never pays for it.
 *
 * What Conch asks of it, on purpose:
 *
 * - `markOnlineOnConnect: false`: your phone keeps its notifications (a
 *   device that says it's online takes them over);
 * - no history sync: Conch reads what arrives from now on, never your past chats;
 * - its keys go only to the session handle Conch gives it (sealed on disk).
 */
import type { WAMessage, WASocket as BaileysSocket } from '@whiskeysockets/baileys';

import type { ChannelFile } from './types';
import type { WaConnect, WaInbound, WaSocket } from './whatsapp';

/** Baileys talks a lot; Conch keeps none of it (it could hold message text). */
const quiet = {
  level: 'silent',
  child: () => quiet,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Messages kept for downloads and WhatsApp's re-send requests, newest last. */
const KEEP = 300;

type Keys = Record<string, Record<string, unknown>>;

export const baileysConnect: WaConnect = async (session, handlers) => {
  const baileys = await import('@whiskeysockets/baileys');
  const { BufferJSON, initAuthCreds, proto, downloadMediaMessage, normalizeMessageContent } =
    baileys;
  const makeSocket = baileys.makeWASocket;

  const raw = await session.read();
  const saved = raw
    ? (JSON.parse(raw, BufferJSON.reviver) as {
        creds: ReturnType<typeof initAuthCreds>;
        keys: Keys;
      })
    : { creds: initAuthCreds(), keys: {} as Keys };
  const { creds, keys } = saved;
  const save = () => session.write(JSON.stringify({ creds, keys }, BufferJSON.replacer));

  const kept = new Map<string, WAMessage>();
  const keep = (message: WAMessage) => {
    const id = message.key.id;
    if (!id) return;
    kept.delete(id);
    kept.set(id, message);
    if (kept.size > KEEP) kept.delete(kept.keys().next().value ?? '');
  };

  const socket: BaileysSocket = makeSocket({
    auth: {
      creds,
      keys: {
        get: (type, ids) => {
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (type === 'app-state-sync-key' && value)
              value = proto.Message.AppStateSyncKeyData.fromObject(
                value as Record<string, unknown>,
              );
            out[id] = value;
          }
          return out as never;
        },
        set: (data) => {
          for (const [type, values] of Object.entries(data)) {
            const bucket = (keys[type] ??= {});
            for (const [id, value] of Object.entries(values ?? {})) {
              if (value) bucket[id] = value;
              else Reflect.deleteProperty(bucket, id);
            }
          }
          save();
        },
      },
    },
    logger: quiet,
    // Shown under Linked devices on the phone.
    browser: ['Conch', 'Desktop', '1.0.0'],
    markOnlineOnConnect: false,
    // What Conch sends isn't handed back as a new message.
    emitOwnEvents: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    // WhatsApp asks for a message again when a phone couldn't decrypt it.
    getMessage: (key) =>
      Promise.resolve(key.id ? (kept.get(key.id)?.message ?? undefined) : undefined),
  });

  socket.ev.on('creds.update', (update) => {
    Object.assign(creds, update);
    save();
  });
  socket.ev.on('connection.update', (update) => {
    if (update.qr) handlers.qr(update.qr);
    if (update.connection === 'open' && socket.user)
      handlers.open({
        jid: socket.user.id,
        ...(socket.user.lid && { lid: socket.user.lid }),
        ...((socket.user.name ?? socket.user.notify) && {
          name: socket.user.name ?? socket.user.notify,
        }),
      });
    if (update.connection === 'close') {
      const error = update.lastDisconnect?.error as
        { message?: string; output?: { statusCode?: number } } | undefined;
      handlers.close(error?.output?.statusCode, error?.message ?? 'Connection closed');
    }
  });
  socket.ev.on('messages.upsert', ({ messages, type }) => {
    const list: WaInbound[] = [];
    for (const message of messages) {
      keep(message);
      const inbound = toInbound(message, normalizeMessageContent);
      if (inbound) list.push(inbound);
    }
    if (list.length) handlers.messages(list, type === 'notify');
  });

  const wrap: WaSocket = {
    async send(chat, text, options) {
      const sent = await socket.sendMessage(
        chat,
        {
          text,
          ...(options?.edit && { edit: { remoteJid: chat, fromMe: true, id: options.edit } }),
        },
        options?.id ? { messageId: options.id } : {},
      );
      if (sent) keep(sent);
      const id = sent?.key.id;
      if (!id) throw new Error('WhatsApp didn’t say it took the message.');
      return id;
    },
    async react(chat, id, fromMe, emoji) {
      await socket.sendMessage(chat, {
        react: { text: emoji, key: { remoteJid: chat, id, fromMe } },
      });
    },
    presence: (chat, state) => socket.sendPresenceUpdate(state, chat),
    read: (chat, id, participant) =>
      socket.readMessages([
        { remoteJid: chat, id, fromMe: false, ...(participant && { participant }) },
      ]),
    async download(id, maxBytes) {
      const message = kept.get(id);
      if (!message) throw new Error('That file is no longer here. Send it again.');
      // Its size is said before downloading: a file too big is refused without fetching it.
      const media = mediaOf(message, normalizeMessageContent);
      if ((sizeOf(media?.fileLength) ?? 0) > maxBytes) throw new Error('That file is too big.');
      const bytes = await downloadMediaMessage(message, 'buffer', {});
      if (bytes.length > maxBytes) throw new Error('That file is too big.');
      return { bytes, ...(media?.mimetype && { mimeType: media.mimetype }) };
    },
    async picture(jid) {
      const url = await socket.profilePictureUrl(jid, 'preview').catch(() => undefined);
      if (!url || !/^https:\/\/[\w.-]+\.whatsapp\.net\//.test(url)) return undefined;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return response.ok ? Buffer.from(await response.arrayBuffer()) : undefined;
    },
    logout: () => socket.logout(),
    end: () => {
      void socket.end(undefined);
    },
  };
  return wrap;
};

type Normalize = (content: WAMessage['message']) => WAMessage['message'];

interface Media {
  mimetype?: string | null;
  fileName?: string | null;
  fileLength?: number | { toNumber(): number } | null;
  caption?: string | null;
}

function mediaOf(message: WAMessage, normalize: Normalize): (Media & { kind: string }) | undefined {
  const content = normalize(message.message);
  if (!content) return undefined;
  for (const kind of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'] as const) {
    const media = content[kind] as Media | null | undefined;
    if (media) return { ...media, kind };
  }
  const caption = content.documentWithCaptionMessage?.message?.documentMessage as Media | undefined;
  return caption ? { ...caption, kind: 'documentMessage' } : undefined;
}

const sizeOf = (length: Media['fileLength']) =>
  typeof length === 'number' ? length : length ? length.toNumber() : undefined;

/** A Baileys message as Conch reads it, or undefined for what isn't a message (receipts, keys). */
function toInbound(message: WAMessage, normalize: Normalize): WaInbound | undefined {
  const key = message.key;
  const chat = key.remoteJid;
  const content = normalize(message.message);
  if (!chat || !key.id || !content) return undefined;
  if (
    content.protocolMessage ||
    content.reactionMessage ||
    (content.senderKeyDistributionMessage && Object.keys(content).length === 1)
  )
    return undefined;
  const media = mediaOf(message, normalize);
  const text = content.conversation ?? content.extendedTextMessage?.text ?? media?.caption ?? '';
  const files: ChannelFile[] = [];
  if (media) {
    const ext = media.mimetype?.split('/')[1]?.split(';')[0] ?? 'bin';
    const name =
      media.fileName ??
      (media.kind === 'audioMessage'
        ? `voice-note.${ext === 'ogg' ? 'ogg' : ext}`
        : `${media.kind.replace('Message', '')}-${key.id}.${ext}`);
    files.push({
      name,
      ref: key.id,
      ...(media.mimetype && { mimeType: media.mimetype }),
      ...(sizeOf(media.fileLength) !== undefined && { size: sizeOf(media.fileLength) }),
    });
  }
  if (!text && !files.length) return undefined;
  const group = chat.endsWith('@g.us');
  const sender = group ? (key.participant ?? '') : chat;
  const alt = group ? key.participantAlt : key.remoteJidAlt;
  const quoted = content.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;
  const at = Number(message.messageTimestamp ?? 0) * 1000 || Date.now();
  return {
    id: key.id,
    chat,
    fromMe: Boolean(key.fromMe),
    sender,
    ...(alt && { senderAlt: alt }),
    ...(message.pushName && { name: message.pushName }),
    at,
    text,
    files,
    group,
    ...(quoted && { quoted }),
  };
}
