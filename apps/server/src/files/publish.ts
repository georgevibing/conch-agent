import { basename } from 'node:path';
import { z } from 'zod';

import type { AttachmentStore } from '../attachments/store';
import type { ToolContext } from '../conversations/manager';
import type { FileAccess } from '../engines/host';
import type { HostTool } from '../engines/types';
import { fileBytes } from './read';

/** A download is an immutable copy in the attachment store, retained with its chat. */
export function publishTools(
  ctx: ToolContext,
  access: () => Promise<FileAccess>,
  store: AttachmentStore,
): HostTool[] {
  return [
    {
      name: 'list_attachments',
      effect: 'read',
      row: true,
      description:
        'Find this chat’s attached files and finished downloads, including pictures generated here. Returns names, paths for read_file/read_document or image editing, and preview cards. Other chats’ files are never listed.',
      input: { offset: z.number().int().min(0).default(0) },
      run: async (args) => {
        const all = (await store.forConversation(ctx.conversationId)).sort(
          (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        );
        const offset = Number(args.offset);
        const items = all.slice(offset, offset + 10);
        return {
          text: JSON.stringify({
            files: await Promise.all(
              items.map(async (a) => ({ ...a, path: (await store.get(a.id))?.path })),
            ),
            nextOffset: offset + 10 < all.length ? offset + 10 : null,
          }),
          view: { kind: 'downloads', items },
        };
      },
    },
    {
      name: 'publish_file',
      row: true,
      description:
        'Give the user a finished file to preview and download in this chat. Copies an existing work-folder file (up to 30 MB) into a durable snapshot. Use for PDFs, spreadsheets, presentations, images, archives and other finished work. Returns an attachment id and a preview/download card. Never claim the file was downloaded; the user presses Download.',
      input: {
        file_path: z.string().min(1).max(4096),
        name: z.string().min(1).max(255).optional(),
      },
      run: async (args) => {
        const bytes = await fileBytes(await access(), String(args.file_path), ctx.signal);
        ctx.signal.throwIfAborted();
        const attachment = await store.save({
          name: args.name ? String(args.name) : basename(String(args.file_path)),
          bytes,
        });
        try {
          await store.claim([attachment.id], ctx.conversationId);
        } catch (error) {
          await store.discard(attachment.id);
          throw error;
        }
        return {
          text: JSON.stringify({
            id: attachment.id,
            name: attachment.name,
            bytes: attachment.size,
            path: (await store.get(attachment.id))?.path,
            message:
              'A preview and Download card is shown in the chat. In a chat that came from a chat app it is sent there with your reply; to send it to one of their chat apps, use message_user with attachments: [id]. Never paste its path into a message.',
          }),
          view: { kind: 'downloads', items: [attachment] },
        };
      },
    },
  ];
}
