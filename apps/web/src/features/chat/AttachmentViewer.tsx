import type { Attachment } from '@conch/protocol';
import {
  AttachmentCard,
  AttachmentList,
  AttachmentPreview,
  type AttachmentInfo,
} from '@conch/nacre';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { attachmentText, attachmentUrl } from './uploads';

/** Something the preview can show: a sent attachment, or a card on the draft. */
export interface Viewable {
  info: AttachmentInfo;
  /** The gateway's id, once it has it. */
  id?: string;
  /** Text already in hand (a draft paste). */
  text?: string;
  /** A local thumbnail, before the gateway has the file. */
  src?: string;
  onTextChange?: (text: string) => void;
  onInsert?: () => void;
}

/** Text previews load the whole file; past this they don't try (the card still downloads). */
const TEXT_PREVIEW_MAX = 4 * 1024 * 1024;

function useText(item: Viewable | undefined, enabled: boolean) {
  const id = item?.id;
  const wanted =
    enabled &&
    item?.text === undefined &&
    item?.info.kind === 'text' &&
    Boolean(id) &&
    (item?.info.size ?? 0) <= TEXT_PREVIEW_MAX;
  return useQuery({
    queryKey: ['attachment-text', id],
    queryFn: ({ signal }) => attachmentText(id ?? '', signal),
    enabled: wanted,
    staleTime: Infinity,
  });
}

/** The preview for a set of attachments, with ← and → between them. */
export function AttachmentViewer({
  items,
  index,
  onIndexChange,
}: {
  items: Viewable[];
  index: number | undefined;
  onIndexChange: (index: number | undefined) => void;
}) {
  const item = index === undefined ? undefined : items[index];
  const text = useText(item, index !== undefined);
  const tooBig =
    item?.info.kind === 'text' &&
    item.text === undefined &&
    (item.info.size ?? 0) > TEXT_PREVIEW_MAX;
  return (
    <AttachmentPreview
      open={item !== undefined}
      onOpenChange={(open) => !open && onIndexChange(undefined)}
      attachment={item?.info}
      src={item?.src ?? (item?.id ? attachmentUrl(item.id) : undefined)}
      text={item?.text ?? text.data}
      loading={text.isLoading}
      error={
        tooBig
          ? 'This one is too long to show here. Download it to read it all.'
          : text.isError
            ? 'Couldn’t load it. It may have been removed with its chat.'
            : undefined
      }
      downloadHref={item?.id ? attachmentUrl(item.id, true) : undefined}
      onTextChange={item?.onTextChange}
      onInsert={item?.onInsert}
      position={index === undefined ? undefined : { index: index + 1, count: items.length }}
      onNavigate={(delta) =>
        index !== undefined && onIndexChange((index + delta + items.length) % items.length)
      }
    />
  );
}

/** A card's first lines for a sent text attachment (small ones only). */
function useExcerpt(attachment: Attachment) {
  const { data } = useQuery({
    queryKey: ['attachment-text', attachment.id],
    queryFn: ({ signal }) => attachmentText(attachment.id, signal),
    enabled: attachment.kind === 'text' && attachment.size <= 256 * 1024,
    staleTime: Infinity,
  });
  return data?.slice(0, 4096);
}

function SentCard({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const excerpt = useExcerpt(attachment);
  const { id: _id, createdAt: _at, transcript, ...info } = attachment;
  return (
    <AttachmentCard
      {...info}
      // A voice note from a chat app (ADR 0077): its words are the message beside it.
      note={transcript !== undefined ? 'Voice note, turned into words on this computer' : undefined}
      excerpt={excerpt}
      src={attachment.kind === 'image' ? attachmentUrl(attachment.id) : undefined}
      density="comfortable"
      onOpen={onOpen}
    />
  );
}

/** What you sent with a message, above its bubble. */
export function SentAttachments({
  attachments,
  made = false,
}: {
  attachments: Attachment[];
  made?: boolean;
}) {
  const [open, setOpen] = useState<number>();
  return (
    <>
      <AttachmentList align={made ? 'start' : 'end'} label={made ? 'Finished files' : 'Attached'}>
        {attachments.map((attachment, i) => (
          <SentCard key={attachment.id} attachment={attachment} onOpen={() => setOpen(i)} />
        ))}
      </AttachmentList>
      <AttachmentViewer
        items={attachments.map((a) => ({ info: a, id: a.id }))}
        index={open}
        onIndexChange={setOpen}
      />
    </>
  );
}
