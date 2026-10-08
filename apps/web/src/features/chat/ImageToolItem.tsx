import type { Attachment } from '@conch/protocol';
import {
  formatDuration,
  ImageMaking,
  secondsLeft,
  type ImageMakingDetail,
  type ImageMakingProps,
} from '@conch/nacre';
import { useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { AttachmentViewer } from './AttachmentViewer';
import { useComposerInsert } from './ToolFound';
import { attachmentUrl } from './uploads';

type Tool = Extract<TranscriptItem, { kind: 'tool' }>;

/** Conch's picture tool, from any provider's naming of it. */
export const isImageTool = (name: string) => /(?:^|__)image_generate$/.test(name);

const str = (o: Record<string, unknown>, key: string) =>
  typeof o[key] === 'string' ? (o[key] as string).trim() || undefined : undefined;

function parse(output: string | undefined): Record<string, unknown> {
  if (!output?.trimStart().startsWith('{')) return {};
  try {
    const value: unknown = JSON.parse(output);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The start of what was asked for, as a name: one short line. */
export function shortPrompt(prompt: string, max = 64): string {
  const first =
    prompt
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? '';
  if (first.length <= max) return first.replace(/[.!?]$/, '');
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).replace(/[,;:]$/, '')}…`;
}

const VENDORS: Record<string, string> = {
  google: 'Google',
  openai: 'OpenAI',
  'black-forest-labs': 'Black Forest Labs',
  'x-ai': 'xAI',
  bytedance: 'ByteDance',
  'bytedance-seed': 'ByteDance',
  stability: 'Stability AI',
  'stability-ai': 'Stability AI',
  recraft: 'Recraft',
  ideogram: 'Ideogram',
};

/** `google/gemini-2.5-flash-image` → `Gemini 2.5 Flash Image, by Google`. */
export function modelWords(id: string): string {
  const [vendor, model] = id.includes('/')
    ? [id.split('/')[0], id.slice(id.indexOf('/') + 1)]
    : [undefined, id];
  const name = (model ?? id)
    .replace(/:.*$/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) =>
      /^(gpt|ai|xl|hd|sd|sdxl)$/i.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
  const by = vendor && (VENDORS[vendor] ?? undefined);
  return by && !name.toLowerCase().startsWith(by.toLowerCase()) ? `${name}, by ${by}` : name;
}

/** What went wrong, without the wrapping a program puts round it. */
export function reasonWords(output: string | undefined): string | undefined {
  const text = output
    ?.replace(/^(?:MCP error -?\d+:\s*)?(?:Error:\s*)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

/**
 * It wasn't made because of an answer, not a failure: you said no, nobody
 * answered, or a rule said no. Read from what was decided (the call keeps it),
 * and, for chats from before that, from the tool's own words.
 */
const unasked = (item: Tool) =>
  item.approval === 'declined' ||
  item.approval === 'expired' ||
  item.approval === 'refused' ||
  (typeof item.output === 'string' && /^the user declined\b/i.test(item.output.trim()));

const notMadeWords: Partial<Record<NonNullable<Tool['approval']>, string>> = {
  expired: 'Not made — no answer in time',
  refused: 'Not made — Conch’s rules didn’t allow it',
};

const pictureOf = (item: Tool): Attachment | undefined =>
  item.view?.kind === 'downloads' ? item.view.items.find((a) => a.kind === 'image') : undefined;

/** Whether this row is drawn as a picture: being made, made, or not made. */
export function drawnAsPicture(item: Tool): boolean {
  if (!isImageTool(item.name)) return false;
  if (item.status === 'running' || item.status === 'pending' || item.status === 'error')
    return true;
  // Done: the picture, or a no. Anything else (the setup offer) is an ordinary row.
  return Boolean(pictureOf(item)) || unasked(item);
}

const usd = (n: number) => (n < 0.01 ? 'under $0.01' : `$${n.toFixed(2)}`);

/**
 * About how long is left, never going up between words: a guess from how far
 * it got slows near the end, and a clock that climbs back reads as broken.
 */
function useSecondsLeft(progress: Tool['progress']): number | undefined {
  const [held, setHeld] = useState<{ left: number; at: number }>();
  const generating = progress?.stage === 'generating' && progress.progress !== undefined;
  const guess = generating
    ? secondsLeft(progress.progress ?? 0, progress.at - progress.since)
    : undefined;
  if (progress && guess !== undefined && held?.at !== progress.at) {
    const left = held
      ? Math.min(guess, Math.max(0, held.left - (progress.at - held.at) / 1000))
      : guess;
    setHeld({ left: Math.round(left), at: progress.at });
  }
  return generating ? held?.left : undefined;
}

/**
 * The picture tool's own row (ADR 0060): the picture taking shape where it
 * will be, then the picture as a card; not made is a calm line. What was
 * asked for and who made it are behind Details, never the raw call.
 */
export function ImageToolItem({
  item,
  asking = false,
}: {
  item: Tool;
  /** It asked first and the question waits under it: nothing is being made yet. */
  asking?: boolean;
}) {
  const input = (item.input ?? {}) as Record<string, unknown>;
  const out = parse(item.output);
  const picture = pictureOf(item);
  const insert = useComposerInsert();
  const [open, setOpen] = useState<number>();
  const left = useSecondsLeft(item.progress);

  const prompt = str(input, 'prompt');
  const named = str(input, 'name');
  const fileName = picture?.name ?? str(out, 'name');
  const title =
    (named && named !== 'Generated image' ? named : undefined) ??
    (prompt ? shortPrompt(prompt) : undefined) ??
    fileName?.replace(/\.[a-z0-9]+$/i, '') ??
    'A picture';

  const running = item.status === 'running' || item.status === 'pending';
  const state: ImageMakingProps['state'] = running
    ? 'making'
    : unasked(item)
      ? 'declined'
      : item.status === 'error'
        ? item.output === 'Stopped.'
          ? 'stopped'
          : 'failed'
        : 'ready';

  const model = str(out, 'model') ?? str(input, 'model');
  const by = str(out, 'by') ?? str(out, 'provider') ?? item.progress?.by;
  const cost = typeof out.costUsd === 'number' ? out.costUsd : undefined;
  const details: ImageMakingDetail[] = [
    ...(model ? [{ label: 'Model', value: modelWords(model) }] : []),
    ...(by
      ? [{ label: 'Made with', value: by }]
      : model?.includes('/')
        ? [{ label: 'Made with', value: 'OpenRouter' }]
        : []),
    ...(picture?.width && picture.height
      ? [{ label: 'Size', value: `${picture.width} × ${picture.height}` }]
      : []),
    ...(state === 'ready' && item.durationMs !== undefined
      ? [{ label: 'Took', value: formatDuration(item.durationMs) }]
      : []),
    ...(cost !== undefined ? [{ label: 'Cost', value: usd(cost) }] : []),
  ];

  const aspect =
    picture?.width && picture.height ? picture.width / picture.height : str(input, 'aspect_ratio');

  return (
    <>
      <ImageMaking
        data-anchor={item.id}
        state={state}
        title={title}
        aspect={aspect}
        editing={Boolean(str(input, 'source'))}
        waiting={asking}
        {...(running &&
          item.progress && {
            progress: item.progress.progress,
            stage: item.progress.stage,
            by: item.progress.by,
            secondsLeft: left,
            // A rough picture so far; gone (deleted by the gateway) once the call ends.
            preview: item.progress.preview ? attachmentUrl(item.progress.preview) : undefined,
          })}
        {...(picture && {
          src: attachmentUrl(picture.id),
          downloadHref: attachmentUrl(picture.id, true),
          downloadName: picture.name,
          onOpen: () => setOpen(0),
          onEdit: () => insert(`Change “${title}”: `),
        })}
        alt={prompt ? shortPrompt(prompt, 160) : title}
        reason={state === 'failed' ? reasonWords(item.output) : undefined}
        notMade={item.approval && notMadeWords[item.approval]}
        prompt={prompt}
        details={details}
      />
      {picture && (
        <AttachmentViewer
          items={[{ info: picture, id: picture.id }]}
          index={open}
          onIndexChange={setOpen}
        />
      )}
    </>
  );
}
