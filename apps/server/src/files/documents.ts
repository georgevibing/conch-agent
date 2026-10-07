import { spawn } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import type { FileAccess } from '../engines/host';
import { fileBytes } from './read';

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
  signal.throwIfAborted();
  const worker = fileURLToPath(new URL('./document-worker.mjs', import.meta.url));
  const modules = ['pdfjs-dist/legacy/build/pdf.mjs', 'fflate', 'fast-xml-parser'].map((id) =>
    dirname(fileURLToPath(import.meta.resolve(id))),
  );
  // Package modules import neighbouring files; permission is read-only and restricted to dependencies.
  const store = `${sep}node_modules${sep}.pnpm`;
  const roots = modules.map((path) =>
    path.includes(`${store}${sep}`)
      ? path.slice(0, path.indexOf(`${store}${sep}`) + store.length)
      : dirname(path),
  );
  const child = spawn(
    process.execPath,
    [
      '--permission',
      ...[
        ...new Set([
          worker,
          resolve(dirname(worker), '../../node_modules'),
          resolve(dirname(worker), '../../package.json'),
          ...roots,
        ]),
      ].map((path) => `--allow-fs-read=${path}`),
      '--max-old-space-size=256',
      worker,
    ],
    {
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let output = '';
  let timeout = false;
  let overflow = false;
  const stop = () => {
    child.kill('SIGKILL');
  };
  const timer = setTimeout(() => {
    timeout = true;
    stop();
  }, 30_000).unref();
  signal.addEventListener('abort', stop, { once: true });
  child.stdin.on('error', () => {});
  child.stderr.resume();
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (output.length > 2_000_000) {
      overflow = true;
      stop();
    }
  });
  const ended = new Promise<number | null>((done, failed) => {
    child.once('error', failed);
    child.once('close', done);
  });
  child.stdin.end(
    JSON.stringify({ data: bytes.toString('base64'), name, offset, limit, textOffset }),
  );
  try {
    const code = await ended;
    signal.throwIfAborted();
    if (timeout)
      throw new Error(
        'Reading this document took too long. Split it into smaller documents and attach those.',
      );
    if (overflow || code !== 0)
      throw new Error(
        'The document exceeded the parser’s limits or could not be decoded. Try saving a fresh PDF or Office copy.',
      );
    // Some PDF decoders print diagnostics before the result. Only our final JSON object counts.
    const value = z
      .object({ result: DocumentResult.optional(), error: z.string().optional() })
      .parse(JSON.parse(output));
    if (!value.result) throw new Error(value.error ?? 'The document could not be read.');
    return value.result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    stop();
  }
}

export function documentTools(ctx: ToolContext, access: () => Promise<FileAccess>): HostTool[] {
  return [
    {
      name: 'read_document',
      effect: 'read',
      row: true,
      description:
        'Read text from PDF, DOCX, XLSX or PPTX files in the work folder or this chat’s attachments (up to 30 MB). Returns page, paragraph-block, sheet or slide references. Use nextOffset for more sections; if a section has nextTextOffset, read its offset with limit=1 and text_offset=nextTextOffset to continue within it. Reports truncation and pages needing visual/OCR reading. Does not execute macros, formulas or external links.',
      input: {
        file_path: z.string().min(1).max(4096),
        offset: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(20).default(5),
        text_offset: z.number().int().min(0).max(40_000_000).default(0),
      },
      run: async (args) =>
        JSON.stringify(
          await extractDocument(
            await fileBytes(await access(), String(args.file_path), ctx.signal),
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
