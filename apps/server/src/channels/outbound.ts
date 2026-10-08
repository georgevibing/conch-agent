/**
 * Pictures and files Conch sends to a chat app: a picture it made, a file it
 * published, sent to you with `message_user` or with its reply in the chat
 * you wrote from. They only ever come from Conch's own attachment store, and
 * only the ones that belong to the conversation asking: never a path the
 * model named, never another chat's file.
 */
import { readFile } from 'node:fs/promises';

import { Id } from '@conch/protocol';

import type { AttachmentStore } from '../attachments/store';
import type { ChannelConnection, OutboundFile, SentRef } from './types';

/** Files one message may carry (Telegram's album; the most any app here groups). */
export const MAX_FILES = 10;

/** The tools whose finished files go with the reply in a chat app's chat. */
export const MAKES_FILES =
  /^(?:mcp__conch__)?(?:image_generate|publish_file|file_(?:make|convert|combine|unzip))$/;

export class OutboundError extends Error {}

/**
 * Whether what a tool made goes back with the answer to this chat: a picture
 * or a document made from words (`file_make`, which reads only what it was
 * told and this chat's own pictures) goes to whoever the answer goes to; an
 * edit, a published, converted, combined or unpacked file (which may come
 * from your work folder) only to the owner. Someone else's chat never
 * carries out a file of yours.
 */
export function mayCarry(made: { name: string; input: unknown }, fromOwner: boolean): boolean {
  if (!MAKES_FILES.test(made.name)) return false;
  if (fromOwner) return true;
  const input = made.input as { source?: unknown } | undefined;
  if (/file_make$/.test(made.name)) return true;
  return /image_generate$/.test(made.name) && input?.source === undefined;
}

/**
 * The conversation's own files by id, read whole. An id that's malformed,
 * unknown, or another chat's is refused by name, before anything is sent.
 */
export async function filesOf(
  store: Pick<AttachmentStore, 'inConversation'>,
  ids: readonly string[],
  conversationId: string | undefined,
): Promise<OutboundFile[]> {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_FILES)
    throw new OutboundError(`At most ${MAX_FILES} files go in one message.`);
  if (unique.length && !conversationId)
    throw new OutboundError('Files can only be sent from a chat they belong to.');
  const files: OutboundFile[] = [];
  for (const id of unique) {
    const found =
      Id.safeParse(id).success && conversationId
        ? await store.inConversation(id, conversationId)
        : undefined;
    const bytes = found && (await readFile(found.path).catch(() => undefined));
    if (!found || !bytes)
      throw new OutboundError(
        `There’s no file “${id.slice(0, 60)}” in this chat. Use the id (att_…) that image_generate, file_make, publish_file or list_attachments gave, never a path.`,
      );
    const { attachment } = found;
    files.push({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      bytes,
      image: attachment.kind === 'image',
      ...(attachment.width && { width: attachment.width }),
      ...(attachment.height && { height: attachment.height }),
    });
  }
  return files;
}

/** What sending files came to, in words the assistant (or the person) can repeat. */
export interface Delivered {
  refs: SentRef[];
  /** The names of the files that went, and their ids. */
  sent: string[];
  ids: string[];
  /** Each file that couldn't go, and why. */
  missed: string[];
}

/**
 * Send files to a chat, with `caption` under them. What the app can't carry
 * (none at all, or one over its limit) is named in `missed`, and the caption
 * still goes as words when no file could.
 */
export async function deliver(
  connection: Pick<ChannelConnection, 'files' | 'send'>,
  app: string,
  chatId: string,
  files: readonly OutboundFile[],
  caption?: string,
): Promise<Delivered> {
  const carrier = connection.files;
  if (!carrier) {
    const refs = caption?.trim() ? await connection.send(chatId, caption) : [];
    return {
      refs,
      sent: [],
      ids: [],
      missed: files.map((f) => `${f.name} (${app} can’t carry files from Conch)`),
    };
  }
  const fits: OutboundFile[] = [];
  const missed: string[] = [];
  for (const f of files) {
    if (carrier.accepts && !carrier.accepts(f))
      missed.push(`${f.name} (${app} takes only pictures from Conch)`);
    else if (f.bytes.length > carrier.maxBytes)
      missed.push(`${f.name} (over ${app}’s ${Math.floor(carrier.maxBytes / 1024 / 1024)} MB)`);
    else fits.push(f);
  }
  if (!fits.length) {
    const refs = caption?.trim() ? await connection.send(chatId, caption) : [];
    return { refs, sent: [], ids: [], missed };
  }
  const refs = await carrier.send(chatId, fits, caption?.trim() || undefined);
  return { refs, sent: fits.map((f) => f.name), ids: fits.map((f) => f.id), missed };
}
