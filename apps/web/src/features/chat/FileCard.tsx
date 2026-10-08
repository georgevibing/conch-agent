import type { Attachment } from '@conch/protocol';
import {
  FileMaking,
  FileTile,
  type FileMakingDetail,
  type FileMakingProps,
  type FileTileProps,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';

import { useChannels } from '../channels/queries';
import { APPS } from '../channels/describe';
import styles from './FileCard.module.css';
import { useComposerInsert } from './ToolFound';
import { attachmentText, attachmentUrl } from './uploads';

/** A text file's first words load for its card only when it's small. */
const EXCERPT_MAX = 256 * 1024;
/** A PDF with no picture of it shows its first page in a frame, when it's not huge. */
const PDF_FACE_MAX = 15 * 1024 * 1024;

/** The first words of a small text file, for its card. */
export function useFileExcerpt(attachment: Attachment | undefined) {
  const { data } = useQuery({
    queryKey: ['attachment-text', attachment?.id],
    queryFn: ({ signal }) => attachmentText(attachment?.id ?? '', signal),
    enabled: attachment?.kind === 'text' && attachment.size <= EXCERPT_MAX,
    staleTime: Infinity,
  });
  return data?.slice(0, 20_000);
}

/** What a file's card shows of it: its facts, a picture of it, and how to get it. */
export function fileFacts(attachment: Attachment) {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    size: attachment.size,
    ...(attachment.pages !== undefined && { pages: attachment.pages }),
    ...(attachment.sheets !== undefined && { sheets: attachment.sheets }),
    ...(attachment.slides !== undefined && { slides: attachment.slides }),
    ...(attachment.kind === 'text' &&
      attachment.lines !== undefined && { lines: attachment.lines }),
    thumbnail: attachment.preview
      ? attachmentUrl(attachment.preview)
      : attachment.kind === 'image'
        ? attachmentUrl(attachment.id)
        : undefined,
    downloadHref: attachmentUrl(attachment.id, true),
  } satisfies Partial<FileTileProps>;
}

/**
 * A PDF's first page, when the gateway has no picture of it: the browser's
 * own viewer in a frame, with nothing in it to press (the card opens it).
 */
export function pdfFace(attachment: Attachment) {
  if (attachment.preview || attachment.size > PDF_FACE_MAX) return undefined;
  if (attachment.mimeType !== 'application/pdf' && !/\.pdf$/i.test(attachment.name))
    return undefined;
  return (
    <span className={styles.pdf}>
      <iframe
        className={styles.pdfFrame}
        src={`${attachmentUrl(attachment.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
        title={`First page of ${attachment.name}`}
        tabIndex={-1}
        loading="lazy"
        aria-hidden
      />
    </span>
  );
}

/**
 * Send it to a chat app: words in the message box, never sent by this press.
 * Only offered when a chat app is set up with someone in it.
 */
export function useSendFile():
  ((name: string) => { label: string; onSend: () => void }) | undefined {
  const { data } = useChannels();
  const insert = useComposerInsert();
  const live = data?.channels.filter((c) => c.enabled && c.people.length > 0) ?? [];
  if (!live.length) return undefined;
  const app = live.length === 1 && live[0] ? APPS[live[0].kind].name : undefined;
  return (name) => ({
    label: app ? `Send to ${app}` : 'Send to a chat app',
    onSend: () => insert(app ? `Send “${name}” to me on ${app}` : `Send “${name}” to `),
  });
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** When it arrived, for Details. */
export const madeAt = (at: number): FileMakingDetail => ({
  label: 'When',
  value: when.format(at),
});

/**
 * A finished file as its card, whoever made or sent it: the same card the
 * file tools draw, for a file another tool offered or a chat app brought.
 */
export function SentFileCard({
  attachment,
  ...props
}: { attachment?: Attachment; 'data-anchor'?: string } & Partial<FileMakingProps>) {
  const excerpt = useFileExcerpt(attachment);
  const send = useSendFile();
  if (!attachment) return <FileMaking state="making" name="A file" {...props} />;
  const sending = send?.(attachment.name);
  return (
    <FileMaking
      data-anchor={attachment.id}
      state="ready"
      {...fileFacts(attachment)}
      excerpt={excerpt}
      face={pdfFace(attachment)}
      details={[madeAt(attachment.createdAt)]}
      {...(sending && { onSend: sending.onSend, sendLabel: sending.label })}
      {...props}
    />
  );
}

/** A file on a message, small: the same glyph, tint and words as its full card. */
export function SentFileTile({
  attachment,
  onOpen,
  note,
}: {
  attachment: Attachment;
  onOpen: () => void;
  note?: string;
}) {
  return <FileTile role="listitem" {...fileFacts(attachment)} note={note} onOpen={onOpen} />;
}
