import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import type { FileAccess } from '../engines/host';
import { namedBytes, type ChatFiles } from './read';
import { runWorker, WorkerFailed } from './worker';

export const DocumentResult = z.object({
  name: z.string(),
  totalSections: z.number().int().nonnegative(),
  sections: z.array(
    z.object({
      label: z.string(),
      text: z.string(),
      truncated: z.boolean(),
      offset: z.number().int(),
      totalCharacters: z.number().int(),
      nextTextOffset: z.number().int().nullable(),
    }),
  ),
  nextOffset: z.number().int().nonnegative().nullable(),
  warnings: z.array(z.string()),
});

/** Only module code is readable; document bytes enter on stdin, never by a caller-supplied path. */
export async function extractDocument(
  bytes: Buffer,
  name: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
  textOffset = 0,
) {
  const output = await runWorker({
    worker: './document-worker.mjs',
    modules: ['pdfjs-dist/legacy/build/pdf.mjs', 'fflate', 'fast-xml-parser'],
    input: JSON.stringify({ data: bytes.toString('base64'), name, offset, limit, textOffset }),
    signal,
  }).catch((error: unknown) => {
    if (error instanceof WorkerFailed && error.reason === 'timeout')
      throw new Error(
        'Reading this document took too long. Split it into smaller documents and attach those.',
      );
    if (error instanceof WorkerFailed)
      throw new Error(
        'The document exceeded the parser’s limits or could not be decoded. Try saving a fresh PDF or Office copy.',
      );
    throw error;
  });
  // Some PDF decoders print diagnostics before the result. Only our final JSON object counts.
  const value = z
    .object({ result: DocumentResult.optional(), error: z.string().optional() })
    .parse(JSON.parse(output));
  if (!value.result) throw new Error(value.error ?? 'The document could not be read.');
  return value.result;
}

export function documentTools(
  ctx: ToolContext,
  access: () => Promise<FileAccess>,
  files?: ChatFiles,
): HostTool[] {
  return [
    {
      name: 'read_document',
      effect: 'read',
      row: true,
      description:
        'Read text from PDF, DOCX, XLSX or PPTX files in the work folder or this chat’s attachments (by path, or by its id: att_…; up to 30 MB). Returns page, paragraph-block, sheet or slide references. Use nextOffset for more sections; if a section has nextTextOffset, read its offset with limit=1 and text_offset=nextTextOffset to continue within it. Reports truncation and pages needing visual/OCR reading. Does not execute macros, formulas or external links.',
      input: {
        file_path: z.string().min(1).max(4096),
        offset: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(20).default(5),
        text_offset: z.number().int().min(0).max(40_000_000).default(0),
      },
      run: async (args) =>
        JSON.stringify(
          await extractDocument(
            await namedBytes(
              access,
              String(args.file_path),
              ctx.signal,
              files && { files, conversationId: ctx.conversationId },
            ),
            String(args.file_path),
            Number(args.offset),
            Number(args.limit),
            ctx.signal,
            Number(args.text_offset),
          ),
        ),
    },
  ];
}
