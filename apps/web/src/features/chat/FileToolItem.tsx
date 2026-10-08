import type { Attachment } from '@conch/protocol';
import {
  formatDuration,
  withExtension,
  type FileMakingDetail,
  type FileMakingProps,
} from '@conch/nacre';
import { useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { AttachmentViewer } from './AttachmentViewer';
import { madeAt, SentFileCard } from './FileCard';
import { notMadeWords, reasonWords, unasked } from './ImageToolItem';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;

/** Conch's file tools, from any provider's naming of them: each is drawn as its file. */
export const isFileTool = (name: string) =>
  /(?:^|__)(?:file_(?:make|convert|combine|unzip)|publish_file)$/.test(name);

const bare = (name: string) => name.replace(/^.*__/, '');

const str = (o: Record<string, unknown>, key: string) =>
  typeof o[key] === 'string' ? (o[key] as string).trim() || undefined : undefined;

/** The last part of a path; a chat's own file (`att_…`) has no name worth saying. */
const baseName = (path: string | undefined) =>
  path && !/^att_/i.test(path) ? path.split(/[\\/]/).filter(Boolean).at(-1) : undefined;

const files = (item: Tool): Attachment[] =>
  item.view?.kind === 'downloads' ? item.view.items : [];

/** Whether this row is drawn as its file: being made, made, or not made. */
export function drawnAsFile(item: Tool): boolean {
  if (!isFileTool(item.name)) return false;
  if (item.status === 'running' || item.status === 'pending' || item.status === 'error')
    return true;
  return files(item).length > 0 || unasked(item);
}

/** What the file will be called and what's being done, from what was asked for. */
export function fileAsked(name: string, input: Record<string, unknown>) {
  const tool = bare(name);
  const named = str(input, 'name');
  switch (tool) {
    case 'file_make':
      return {
        name: withExtension(named ?? str(input, 'title') ?? 'A file', str(input, 'format')),
        doing: 'Making it',
      };
    case 'file_convert': {
      const to = str(input, 'to');
      const from = baseName(str(input, 'source'))?.replace(/\.[^.]+$/, '');
      return { name: withExtension(named ?? from ?? 'A file', to), doing: 'Converting' };
    }
    case 'file_combine': {
      const to = str(input, 'to');
      return {
        name: withExtension(named ?? (to === 'zip' ? 'Files' : 'Combined'), to),
        doing: to === 'zip' ? 'Packing' : 'Combining',
      };
    }
    case 'file_unzip':
      return { name: baseName(str(input, 'source')) ?? 'An archive', doing: 'Unpacking' };
    default:
      return {
        name: named ?? baseName(str(input, 'file_path') ?? str(input, 'path')) ?? 'A file',
        doing: 'Keeping it',
      };
  }
}

function parse(output: string | undefined): Record<string, unknown> {
  if (!output?.trimStart().startsWith('{')) return {};
  try {
    const value: unknown = JSON.parse(output);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A file tool's own row (ADR 0060): the file taking shape where it will be,
 * then the file as its card (several, for an unpacked archive); not made is
 * a calm line. Who made it and when are behind Details, never the raw call
 * or a path.
 */
export function FileToolItem({ item, asking = false }: { item: Tool; asking?: boolean }) {
  const input = (item.input ?? {}) as Record<string, unknown>;
  const out = parse(item.output);
  const made = files(item);
  const [open, setOpen] = useState<number>();
  const asked = fileAsked(item.name, input);

  const running = item.status === 'running' || item.status === 'pending';
  const state: FileMakingProps['state'] = running
    ? 'making'
    : unasked(item)
      ? 'declined'
      : item.status === 'error'
        ? item.output === 'Stopped.'
          ? 'stopped'
          : 'failed'
        : 'ready';

  const by = str(out, 'by') ?? item.progress?.by;
  const details: FileMakingDetail[] = [
    ...(by ? [{ label: 'Made with', value: by }] : []),
    madeAt(item.startedAt),
    ...(state === 'ready' && item.durationMs !== undefined
      ? [{ label: 'Took', value: formatDuration(item.durationMs) }]
      : []),
  ];

  // Being made, or not made: one card, the same one the file then rises in.
  const pending = state !== 'ready' || !made.length;
  const first: Partial<FileMakingProps> = pending
    ? {
        state: state === 'ready' ? 'failed' : state,
        name: asked.name,
        doing: asked.doing,
        waiting: asking,
        ...(running &&
          item.progress && {
            progress: item.progress.progress,
            stage: item.progress.stage,
            detail: item.progress.detail,
            by: item.progress.by,
          }),
        reason: state === 'failed' ? reasonWords(item.output) : undefined,
        notMade: item.approval && notMadeWords[item.approval],
        details: state === 'making' ? undefined : details,
      }
    : {};

  return (
    <>
      {/* One list either way, so the card being made is the one the file rises in. */}
      {pending
        ? [<SentFileCard key="file" data-anchor={item.id} {...first} />]
        : made.map((attachment, i) => (
            <SentFileCard
              key={i === 0 ? 'file' : attachment.id}
              data-anchor={i === 0 ? item.id : attachment.id}
              attachment={attachment}
              onOpen={() => setOpen(i)}
              details={[
                ...details.filter((d) => d.label !== 'When'),
                madeAt(attachment.createdAt || item.startedAt),
              ]}
            />
          ))}
      <AttachmentViewer
        items={made.map((a) => ({ info: a, id: a.id }))}
        index={open}
        onIndexChange={setOpen}
      />
    </>
  );
}
