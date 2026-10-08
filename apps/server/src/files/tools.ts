import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import type { FileAccess } from '../engines/host';
import { readTextPage, searchFiles, type ChatFiles } from './read';

export function fileTools(
  ctx: ToolContext,
  access: () => Promise<FileAccess>,
  files?: ChatFiles,
): HostTool[] {
  return [
    {
      name: 'read_file',
      effect: 'read',
      row: true,
      description:
        'Read a UTF-8 text file in the work folder or this chat’s attachments (by path, or by its id: att_…), up to 30 MB. Returns numbered lines and nextOffset; repeat with offset to continue. Binary PDF and Office files use read_document. Long lines are explicitly shortened.',
      input: {
        file_path: z.string().min(1).max(4096),
        offset: z.number().int().min(0).max(30_000_000).default(0),
        limit: z.number().int().min(1).max(1000).default(200),
      },
      run: async (args) =>
        JSON.stringify(
          await readTextPage(
            access,
            String(args.file_path),
            ctx.signal,
            Number(args.offset),
            Number(args.limit),
            files && { files, conversationId: ctx.conversationId },
          ),
        ),
    },
    {
      name: 'search_files',
      effect: 'read',
      row: true,
      description:
        'Search filenames and UTF-8 file contents in the work folder. Both filters are literal text, not regex. Returns paths, line numbers, matching text and continuation. No shell needed. Skips links, secrets, dependencies and build output.',
      input: {
        path: z.string().min(1).max(4096).default('.'),
        name: z.string().min(1).max(200).optional(),
        text: z.string().min(1).max(500).optional(),
        case_sensitive: z.boolean().default(false),
        offset: z.number().int().min(0).max(20_000).default(0),
        limit: z.number().int().min(1).max(100).default(30),
      },
      run: async (args) => {
        const result = await searchFiles(
          await access(),
          {
            path: String(args.path),
            name: args.name as string | undefined,
            text: args.text as string | undefined,
            caseSensitive: args.case_sensitive === true,
            offset: Number(args.offset),
            limit: Number(args.limit),
          },
          ctx.signal,
        );
        return {
          text: JSON.stringify(result),
          view: {
            kind: 'files',
            items: result.matches
              .slice(0, 30)
              .map((m) => ({ name: m.line ? `${m.path}:${m.line}` : m.path })),
          },
        };
      },
    },
  ];
}
