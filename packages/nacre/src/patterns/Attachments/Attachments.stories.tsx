import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../../components/Button';
import { Composer } from '../Composer';
import { Message } from '../Message';
import { AttachmentCard, AttachmentList } from './AttachmentCard';
import { AttachmentPreview } from './AttachmentPreview';
import { DropOverlay, useFileDrop } from './DropOverlay';
import type { AttachmentInfo } from './fileType';

/** A small painted landscape, so image stories need no network. */
const landscape = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 16 10">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d5c3"/><stop offset=".6" stop-color="#e9b8a7"/><stop offset="1" stop-color="#b98a9e"/></linearGradient></defs>
    <rect width="16" height="10" fill="url(#s)"/><circle cx="11.5" cy="4" r="1.6" fill="#fff4e8" opacity=".9"/>
    <path d="M0 7.2 4 5l3 1.8L10.5 4.6 16 7.4V10H0z" fill="#8a6f8f"/><path d="M0 8.4 5 6.6l4 1.5 3-1.1 4 1.3V10H0z" fill="#5d4c6b"/>
  </svg>`,
)}`;
const portrait = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 9 12">
    <rect width="9" height="12" fill="#dfe8e4"/><circle cx="4.5" cy="4.6" r="2" fill="#9fb8ae"/><rect x="1.5" y="7.2" width="6" height="4.8" rx="3" fill="#7d9a90"/>
  </svg>`,
)}`;

const pasted = `2026-09-30T08:14:02Z ERROR payments.worker  charge failed: card_declined (req_8f2a)
2026-09-30T08:14:02Z WARN  payments.worker  retrying in 4s (attempt 2/5)
2026-09-30T08:14:06Z ERROR payments.worker  charge failed: card_declined (req_8f2a)
2026-09-30T08:14:06Z INFO  payments.worker  giving up after 2 declines, notifying customer
`.repeat(12);

const csv = `name,team,started,commits
Ada Lovelace,Platform,2023-04-01,1289
Grace Hopper,Compilers,2022-11-15,2310
Katherine Johnson,Navigation,2024-01-08,412
Margaret Hamilton,Flight,2021-06-30,3021
Radia Perlman,Networking,2023-09-12,877`;

const code = `import { z } from 'zod';

export const Attachment = z.object({
  id: z.string(),
  name: z.string().min(1).max(255),
  kind: z.enum(['text', 'image', 'file']),
});
`;

const every: (AttachmentInfo & { excerpt?: string; src?: string })[] = [
  { name: 'Pasted text', kind: 'text', pasted: true, lines: 48, excerpt: pasted },
  { name: 'team.csv', kind: 'text', mimeType: 'text/csv', lines: 6, excerpt: csv },
  { name: 'attachments.ts', kind: 'text', lines: 8, excerpt: code },
  {
    name: 'Q3 board update — final (v7).pdf',
    kind: 'file',
    mimeType: 'application/pdf',
    size: 2_480_000,
  },
  { name: 'Offer letter.docx', kind: 'file', size: 88_000 },
  { name: 'Forecast 2027.xlsx', kind: 'file', size: 412_000 },
  { name: 'Launch plan.pptx', kind: 'file', size: 9_800_000 },
  { name: 'photos.zip', kind: 'file', size: 24_600_000 },
  {
    name: 'Sunset.png',
    kind: 'image',
    mimeType: 'image/png',
    width: 1600,
    height: 1000,
    src: landscape,
  },
  { name: 'Voice memo.m4a', kind: 'file', mimeType: 'audio/mp4', size: 1_200_000 },
  { name: 'Screen recording.mov', kind: 'file', mimeType: 'video/quicktime', size: 18_000_000 },
  { name: 'backup.bin', kind: 'file', size: 5_000 },
];

const meta = {
  title: 'Patterns/Chat/Attachments',
  component: AttachmentCard,
  args: {
    name: 'Pasted text',
    kind: 'text',
    pasted: true,
    lines: 48,
    excerpt: pasted,
    onOpen: fn(),
    onRemove: fn(),
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'What travels with a message. A long paste folds into a card that shows its first lines in type, pictures show as thumbnails, and every other file gets a tinted badge that says what it is at a glance (PDF red, sheets green, documents blue, slides amber). Cards open a preview, lift a little on hover, breathe while uploading and say plainly when something failed. In the composer every card is the same small size; in the transcript pictures show their true shape.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ paddingBlock: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AttachmentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <AttachmentList>
      <AttachmentCard {...args} />
    </AttachmentList>
  ),
};

/** Every family, each with its own glyph and tint. */
export const EveryKind: Story = {
  render: () => (
    <AttachmentList style={{ maxInlineSize: 760 }}>
      {every.map((a) => (
        <AttachmentCard key={a.name} {...a} onOpen={fn()} onRemove={fn()} />
      ))}
    </AttachmentList>
  ),
};

export const States: Story = {
  render: () => (
    <AttachmentList>
      <AttachmentCard
        name="Q3 board update.pdf"
        kind="file"
        mimeType="application/pdf"
        size={2_480_000}
        status="uploading"
        progress={0.62}
        onRemove={fn()}
      />
      <AttachmentCard
        name="Sunset.png"
        kind="image"
        src={landscape}
        status="uploading"
        onRemove={fn()}
      />
      <AttachmentCard
        name="huge-export.csv"
        kind="text"
        size={41_000_000}
        status="error"
        error="Over 30 MB, the most Conch takes."
        onRemove={fn()}
      />
      <AttachmentCard
        name="notes.md"
        kind="text"
        lines={12}
        excerpt="# Notes"
        status="error"
        error="Couldn’t upload. Check the connection."
        onRetry={fn()}
        onRemove={fn()}
      />
      <AttachmentCard
        name="Diagram.png"
        kind="image"
        src={portrait}
        note="This model can’t see images. Pick another, or send it anyway."
        onOpen={fn()}
        onRemove={fn()}
      />
    </AttachmentList>
  ),
};

/** Long pastes fold into a card; the attach button and pasted screenshots add files. */
export const InTheComposer: Story = {
  render: function Render() {
    const [items, setItems] = useState(every.slice(0, 4));
    const [draft, setDraft] = useState('Can you tell me why these keep failing?');
    return (
      <div style={{ maxInlineSize: 720, marginInline: 'auto' }}>
        <Composer
          value={draft}
          onValueChange={setDraft}
          canSubmitEmpty={items.length > 0}
          onFiles={fn()}
          onLongPaste={(text) =>
            setItems((list) => [
              ...list,
              {
                name: 'Pasted text',
                kind: 'text',
                pasted: true,
                lines: text.split('\n').length,
                excerpt: text,
              },
            ])
          }
          attachments={
            items.length
              ? items.map((a, i) => (
                  <AttachmentCard
                    key={`${a.name}-${i}`}
                    {...a}
                    onOpen={fn()}
                    onRemove={() => setItems((list) => list.filter((_, j) => j !== i))}
                  />
                ))
              : undefined
          }
        />
      </div>
    );
  },
};

/** Your own message, with what you sent above it. Pictures keep their shape. */
export const InTheTranscript: Story = {
  render: () => (
    <div style={{ maxInlineSize: 720, marginInline: 'auto', display: 'grid', gap: 12 }}>
      <AttachmentList align="end" label="Attached">
        <AttachmentCard
          name="Sunset.png"
          kind="image"
          width={1600}
          height={1000}
          src={landscape}
          density="comfortable"
          onOpen={fn()}
        />
        <AttachmentCard
          name="Portrait.png"
          kind="image"
          width={900}
          height={1200}
          src={portrait}
          density="comfortable"
          onOpen={fn()}
        />
        <AttachmentCard {...(every[0] as AttachmentInfo)} density="comfortable" onOpen={fn()} />
        <AttachmentCard {...(every[3] as AttachmentInfo)} density="comfortable" onOpen={fn()} />
      </AttachmentList>
      <Message from="user">Which of these should go in the deck?</Message>
    </div>
  ),
};

function PreviewDemo(
  props: Omit<Parameters<typeof AttachmentPreview>[0], 'open' | 'onOpenChange'>,
) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open preview</Button>
      <AttachmentPreview open={open} onOpenChange={setOpen} {...props} />
    </>
  );
}

/** A paste that hasn't been sent yet: edit it in place, or put it back in the message. */
export const PreviewPastedText: Story = {
  render: function Render() {
    const [text, setText] = useState(pasted);
    return (
      <PreviewDemo
        attachment={{
          name: 'Pasted text',
          kind: 'text',
          pasted: true,
          lines: text.split('\n').length,
        }}
        text={text}
        onTextChange={setText}
        onInsert={fn()}
      />
    );
  },
};

export const PreviewTable: Story = {
  render: () => (
    <PreviewDemo
      attachment={{ name: 'team.csv', kind: 'text', mimeType: 'text/csv', lines: 6, size: 312 }}
      text={csv}
      downloadHref="#"
      position={{ index: 2, count: 4 }}
      onNavigate={fn()}
    />
  ),
};

export const PreviewCode: Story = {
  render: () => (
    <PreviewDemo
      attachment={{ name: 'attachments.ts', kind: 'text', lines: 8, size: 190 }}
      text={code}
      downloadHref="#"
    />
  ),
};

export const PreviewImage: Story = {
  render: () => (
    <PreviewDemo
      attachment={{
        name: 'Sunset.png',
        kind: 'image',
        mimeType: 'image/png',
        width: 1600,
        height: 1000,
        size: 812_000,
      }}
      src={landscape}
      downloadHref="#"
    />
  ),
};

export const PreviewNoPreview: Story = {
  render: () => (
    <PreviewDemo
      attachment={{ name: 'Forecast 2027.xlsx', kind: 'file', size: 412_000 }}
      downloadHref="#"
    />
  ),
};

/** Drag files from your desktop over this box. */
export const DropTarget: Story = {
  render: function Render() {
    const [dropped, setDropped] = useState<string[]>([]);
    const drop = useFileDrop({ onDrop: ({ files }) => setDropped(files.map((f) => f.name)) });
    return (
      <div
        {...drop.props}
        style={{
          position: 'relative',
          blockSize: 360,
          borderRadius: 16,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--nc-surface)',
          boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
        }}
      >
        <span style={{ color: 'var(--nc-text-muted)' }}>
          {dropped.length ? `Dropped: ${dropped.join(', ')}` : 'Drag a file here'}
        </span>
        <DropOverlay
          active={drop.dragging}
          hint="Pictures, PDFs, text and more — up to 30 MB each"
        />
      </div>
    );
  },
};

/** The overlay on its own, as it looks mid-drag. */
export const DropOverlayActive: Story = {
  render: () => (
    <div
      style={{
        position: 'relative',
        blockSize: 360,
        borderRadius: 16,
        background: 'var(--nc-surface)',
      }}
    >
      <DropOverlay active hint="Pictures, PDFs, text and more — up to 30 MB each" />
    </div>
  ),
};
