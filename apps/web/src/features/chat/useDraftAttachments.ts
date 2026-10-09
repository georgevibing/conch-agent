import { ATTACHMENT_LIMITS, type Attachment, countLines } from '@conch/protocol';
import { toast, type AttachmentStatus } from '@conch/nacre';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { attachmentText, discardAttachment, fitImage, uploadAttachment } from './uploads';

/** One card on the message being written. */
export interface Draft {
  key: string;
  name: string;
  kind: Attachment['kind'];
  mimeType?: string;
  size?: number;
  lines?: number;
  pasted?: boolean;
  width?: number;
  height?: number;
  /** First lines, for the card. */
  excerpt?: string;
  /** Local thumbnail for a picture. */
  src?: string;
  /** A paste's full text, editable until it's sent. */
  text?: string;
  status: AttachmentStatus;
  progress?: number;
  error?: string;
  /** Set once the gateway has it. */
  attachment?: Attachment;
  /** Name and size as picked, to spot the same file twice. */
  signature?: string;
}

/** What a card says when its file was let go while the message waited (ADR 0124). */
export const LOST_WORDS = 'This file is no longer on Conch. Remove it, then attach it again.';

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|toml|ini|log|env|svg|vue|svelte|lua)$/i;
const MB = 1024 * 1024;

/** What a file most likely is, until the gateway says for sure. */
function guessKind(file: File): Attachment['kind'] {
  if (IMAGE.test(file.type)) return 'image';
  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) return 'text';
  return 'file';
}

/** The same file picked twice (its date can differ between pickers, so it isn't used). */
const signature = (file: File) => `${file.name}:${file.size}`;

/** Pixel size of a picture, for the card and the preview. */
function imageSize(src: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

function draftFrom(attachment: Attachment): Draft {
  return {
    key: attachment.id,
    name: attachment.name,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    size: attachment.size,
    lines: attachment.lines,
    pasted: attachment.pasted,
    width: attachment.width,
    height: attachment.height,
    status: 'ready',
    attachment,
  };
}

/**
 * The attachments on the message being written: files picked, dropped or
 * pasted, and long pastes folded into cards. Each uploads at once (so Send
 * is instant), shows its progress, can be retried, edited (pastes) or taken
 * off, and anything the gateway won't take is refused before it's sent, with
 * the reason on the card.
 */
export function useDraftAttachments(initial: readonly Attachment[] = []) {
  // A draft kept from before shows its cards from the first frame (ADR 0124).
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(draftFrom));
  const uploads = useRef(new Map<string, AbortController>());
  const sources = useRef(new Map<string, Blob>());
  /** The latest list, readable at once from async work (state lags a render behind). */
  const current = useRef<Draft[]>(drafts);
  const commit = useCallback((next: (list: Draft[]) => Draft[]) => {
    current.current = next(current.current);
    setDrafts(current.current);
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<Draft>) => {
      commit((list) => list.map((d) => (d.key === key ? { ...d, ...change } : d)));
    },
    [commit],
  );

  const upload = useCallback(
    (key: string, body: Blob, name: string, pasted?: boolean) => {
      uploads.current.get(key)?.abort();
      const abort = new AbortController();
      uploads.current.set(key, abort);
      patch(key, { status: 'uploading', progress: undefined, error: undefined });
      uploadAttachment(body, {
        name,
        pasted,
        signal: abort.signal,
        onProgress: (progress) => patch(key, { progress }),
      }).then(
        (attachment) => {
          uploads.current.delete(key);
          if (!current.current.some((d) => d.key === key)) return discardAttachment(attachment.id);
          patch(key, {
            status: 'ready',
            progress: undefined,
            attachment,
            // The gateway's word on what it is wins over the guess.
            kind: attachment.kind,
            mimeType: attachment.mimeType,
            lines: attachment.lines,
            width: attachment.width ?? undefined,
            height: attachment.height ?? undefined,
            size: attachment.size,
          });
        },
        (error: unknown) => {
          if (abort.signal.aborted) return;
          uploads.current.delete(key);
          patch(key, {
            status: 'error',
            error: error instanceof ApiError ? error.message : 'Couldn’t upload. Try again.',
          });
        },
      );
    },
    [patch],
  );

  const room = () => ATTACHMENT_LIMITS.maxCount - current.current.length;

  const addFiles = useCallback(
    async (files: File[], folders: string[] = []) => {
      if (folders.length) {
        toast('Folders can’t be attached', {
          description: `Drop the files inside ${folders.length === 1 ? `“${folders[0]}”` : 'them'}, or zip the folder first.`,
        });
      }
      const seen = new Set(current.current.map((d) => d.signature));
      const fresh = files.filter((f, i) => {
        const sig = signature(f);
        const twice = seen.has(sig) || files.findIndex((o) => signature(o) === sig) < i;
        return !twice;
      });
      if (fresh.length < files.length)
        toast('Already attached', { description: 'That file is on this message.' });
      const space = room();
      if (fresh.length > space) {
        toast(`Up to ${ATTACHMENT_LIMITS.maxCount} attachments per message`, {
          description:
            space > 0
              ? `Added the first ${space}. Send these, then attach the rest to the next message.`
              : 'Send this message, then attach the rest to the next one.',
        });
      }
      for (const original of fresh.slice(0, Math.max(0, space))) {
        const key = `file:${crypto.randomUUID().slice(0, 8)}`;
        const kind = guessKind(original);
        const draft: Draft = {
          key,
          name: original.name || 'Pasted image',
          kind,
          mimeType: original.type || undefined,
          size: original.size,
          signature: signature(original),
          status: 'uploading',
        };
        if (!original.size) {
          draft.status = 'error';
          draft.error = 'That file is empty.';
        } else if (original.size > ATTACHMENT_LIMITS.maxBytes && kind !== 'image') {
          draft.status = 'error';
          draft.error = `Over ${ATTACHMENT_LIMITS.maxBytes / MB} MB, the most Conch takes.`;
        }
        if (kind === 'image') draft.src = URL.createObjectURL(original);
        commit((list) => [...list, draft]);
        if (draft.status === 'error') continue;

        // Pictures that are too big for the models are scaled down first.
        const file = kind === 'image' ? await fitImage(original) : original;
        if (file.size > ATTACHMENT_LIMITS.maxBytes) {
          patch(key, {
            status: 'error',
            error: `Over ${ATTACHMENT_LIMITS.maxBytes / MB} MB, the most Conch takes.`,
          });
          continue;
        }
        if (kind === 'image' && draft.src) {
          const size = await imageSize(draft.src);
          if (size) patch(key, size);
        }
        if (kind === 'text') {
          const head = await file
            .slice(0, 4096)
            .text()
            .catch(() => '');
          patch(key, { excerpt: head });
        }
        sources.current.set(key, file);
        upload(key, file, file.name || 'Pasted image');
      }
    },
    [commit, patch, upload],
  );

  const addPaste = useCallback(
    (text: string) => {
      if (room() <= 0) {
        toast(`Up to ${ATTACHMENT_LIMITS.maxCount} attachments per message`);
        return;
      }
      const key = `paste:${crypto.randomUUID().slice(0, 8)}`;
      commit((list) => [
        ...list,
        {
          key,
          name: 'Pasted text',
          kind: 'text',
          pasted: true,
          text,
          excerpt: text.slice(0, 4096),
          lines: countLines(text),
          size: new Blob([text]).size,
          status: 'uploading',
        },
      ]);
      const blob = new Blob([text], { type: 'text/plain' });
      sources.current.set(key, blob);
      upload(key, blob, 'Pasted text', true);
    },
    [commit, upload],
  );

  const remove = useCallback(
    (key: string) => {
      const draft = current.current.find((d) => d.key === key);
      if (!draft) return;
      uploads.current.get(key)?.abort();
      uploads.current.delete(key);
      sources.current.delete(key);
      if (draft.attachment) discardAttachment(draft.attachment.id);
      if (draft.src?.startsWith('blob:')) URL.revokeObjectURL(draft.src);
      commit((list) => list.filter((d) => d.key !== key));
    },
    [commit],
  );

  const retry = useCallback(
    (key: string) => {
      const draft = current.current.find((d) => d.key === key);
      const source = sources.current.get(key);
      if (draft && source) upload(key, source, draft.name, draft.pasted);
    },
    [upload],
  );

  /** Edit a paste: the card updates at once, the upload follows when typing pauses. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const editPaste = useCallback(
    (key: string, text: string) => {
      const draft = current.current.find((d) => d.key === key);
      if (!draft?.pasted) return;
      patch(key, {
        text,
        excerpt: text.slice(0, 4096),
        lines: countLines(text),
        status: 'uploading',
        progress: undefined,
      });
      clearTimeout(timers.current.get(key));
      timers.current.set(
        key,
        setTimeout(() => {
          const old = current.current.find((d) => d.key === key)?.attachment;
          if (old) discardAttachment(old.id);
          patch(key, { attachment: undefined });
          const blob = new Blob([text], { type: 'text/plain' });
          sources.current.set(key, blob);
          upload(key, blob, 'Pasted text', true);
        }, 500),
      );
    },
    [patch, upload],
  );

  /** Everything is sent: forget the cards (the gateway keeps the files for the chat). */
  const clear = useCallback(() => {
    for (const draft of current.current)
      if (draft.src?.startsWith('blob:')) URL.revokeObjectURL(draft.src);
    uploads.current.clear();
    sources.current.clear();
    commit(() => []);
  }, [commit]);

  /** A message came back unsent: put its attachments back on the composer. */
  const restore = useCallback(
    (attachments: Attachment[]) => {
      commit((list) => [
        ...list,
        ...attachments.filter((a) => !list.some((d) => d.key === a.id)).map(draftFrom),
      ]);
    },
    [commit],
  );

  /** Name attachments that are no longer on Conch: their cards say so and offer to come off. */
  const markLost = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      commit((list) =>
        list.map((d) =>
          d.attachment && gone.has(d.attachment.id)
            ? { ...d, status: 'lost', error: LOST_WORDS, progress: undefined }
            : d,
        ),
      );
    },
    [commit],
  );

  /**
   * A draft kept by Conch replaces what's here (written on another device, or
   * before a reload). Cards for files it no longer has stay, saying so.
   */
  const adopt = useCallback(
    (attachments: readonly Attachment[], missing: readonly string[] = []) => {
      const gone = new Set(missing);
      commit((list) => {
        const kept = attachments.map(
          (a) =>
            list.find((d) => d.attachment?.id === a.id && d.status === 'ready') ?? draftFrom(a),
        );
        const lost = list
          .filter((d) => d.attachment && gone.has(d.attachment.id))
          .map((d): Draft => ({ ...d, status: 'lost', error: LOST_WORDS, progress: undefined }));
        // Still uploading here: it joins the draft once it's in.
        const coming = list.filter((d) => d.status === 'uploading' || d.status === 'error');
        return [...kept, ...lost, ...coming];
      });
    },
    [commit],
  );

  // A text card kept from before has only its name: its first lines (and a paste's
  // words, to edit) come from Conch. One that's gone says so.
  const fetching = useRef(new Set<string>());
  useEffect(() => {
    for (const d of drafts) {
      const id = d.attachment?.id;
      if (!id || d.kind !== 'text' || d.excerpt !== undefined || d.status !== 'ready') continue;
      if (fetching.current.has(id)) continue;
      fetching.current.add(id);
      attachmentText(id).then(
        (text) => {
          fetching.current.delete(id);
          patch(d.key, { excerpt: text.slice(0, 4096), ...(d.pasted && { text }) });
        },
        (error: unknown) => {
          fetching.current.delete(id);
          if (error instanceof ApiError && error.status === 404) markLost([id]);
          else patch(d.key, { excerpt: '' });
        },
      );
    }
  }, [drafts, patch, markLost]);

  useEffect(
    () => () => {
      for (const abort of uploads.current.values()) abort.abort();
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const ready = drafts.flatMap((d) => (d.status === 'ready' && d.attachment ? [d.attachment] : []));
  return {
    drafts,
    /** Attachments the gateway has, ready to send. */
    ready,
    uploading: drafts.some((d) => d.status === 'uploading'),
    failed: drafts.filter((d) => d.status === 'error').length,
    /** Cards whose file is no longer on Conch: they have to come off before it's sent. */
    lost: drafts.filter((d) => d.status === 'lost').length,
    addFiles,
    addPaste,
    editPaste,
    remove,
    retry,
    clear,
    restore,
    adopt,
    markLost,
  };
}
