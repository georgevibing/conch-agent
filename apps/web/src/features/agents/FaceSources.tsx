import { AGENT_LIMITS, type Tone } from '@conch/protocol';
import {
  AvatarCropper,
  Button,
  Dialog,
  Field,
  PICTURE_ACCEPT,
  Text,
  Textarea,
  closePicture,
  openPicture,
  toast,
  type OpenedPicture,
} from '@conch/nacre';
import { ImageUp, WandSparkles } from 'lucide-react';
import { useRef, useState } from 'react';

import { useAvatarGeneration, useGenerateAvatar } from './api';

/** A picture made from base64, as the gateway hands one back. */
function blobOf(data: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

/**
 * The other ways to a face, under the cast: **Upload a picture** (framed in
 * the browser and shrunk to fit), and **Create with AI** — only when a
 * provider that makes pictures is connected, saying who makes it and that it
 * costs a little. A made picture is framed the same way before it's kept.
 */
export function FaceSources({
  name,
  tone,
  onPicture,
}: {
  name: string;
  tone: Tone;
  /** The framed picture, ready to keep. */
  onPicture: (picture: Blob) => Promise<void> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [picture, setPicture] = useState<OpenedPicture>();
  const [asking, setAsking] = useState(false);
  const generation = useAvatarGeneration();
  const can = generation.data?.available;

  const frame = async (file: Blob) => {
    try {
      setPicture(await openPicture(file));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const close = () => {
    closePicture(picture);
    setPicture(undefined);
  };

  return (
    <>
      <Button
        size="sm"
        variant="surface"
        leadingIcon={<ImageUp />}
        onClick={() => input.current?.click()}
      >
        Upload a picture
      </Button>
      {can && (
        <Button
          size="sm"
          variant="surface"
          leadingIcon={<WandSparkles />}
          onClick={() => setAsking(true)}
        >
          Create with AI
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        hidden
        tabIndex={-1}
        aria-label="Choose a picture"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void frame(file);
        }}
      />
      <MakeFace
        open={asking}
        name={name}
        tone={tone}
        by={generation.data?.by}
        paid={generation.data?.paid}
        onClose={() => setAsking(false)}
        onMade={(made) => {
          setAsking(false);
          void frame(made);
        }}
      />
      <AvatarCropper
        picture={picture}
        shape="tile"
        title="Frame the picture"
        description="Drag it to move it, and zoom until the face fills the tile."
        confirmLabel="Use this picture"
        maxBytes={AGENT_LIMITS.avatarBytes}
        onClose={close}
        onSave={async (framed) => {
          await onPicture(framed);
          close();
        }}
      />
    </>
  );
}

/** What the picture should show, in a few words; made by the provider, then framed. */
function MakeFace({
  open,
  name,
  tone,
  by,
  paid,
  onClose,
  onMade,
}: {
  open: boolean;
  name: string;
  tone: Tone;
  by?: string;
  paid?: boolean;
  onClose: () => void;
  onMade: (picture: Blob) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const make = useGenerateAvatar();
  const submit = () => {
    const words = prompt.trim();
    if (!words || make.isPending) return;
    make.mutate(
      { prompt: words, ...(name.trim() && { name: name.trim() }), tone },
      {
        onSuccess: (made) => {
          if (made.costUsd !== undefined && made.costUsd > 0)
            toast(`Made for $${made.costUsd.toFixed(made.costUsd < 0.1 ? 3 : 2)}`);
          onMade(blobOf(made.data, made.type));
        },
      },
    );
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>Create a face</Dialog.Title>
          <Dialog.Description>
            {by ? `${by} makes it from your words` : 'Made from your words'}
            {paid ? ', for a few cents.' : '.'} You frame it before it’s kept.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <form
            id="make-face"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field invalid={make.isError}>
              <Field.Label>What it looks like</Field.Label>
              <Textarea
                minRows={2}
                maxRows={5}
                maxLength={AGENT_LIMITS.avatarPrompt}
                value={prompt}
                placeholder="A cheerful fox in a green scarf, flat illustration"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {make.isError && (
                <Field.Error>{make.error.message || 'No picture was made. Try again.'}</Field.Error>
              )}
            </Field>
          </form>
          {make.isPending && (
            <Text size="xs" tone="muted" role="status">
              Making it… this can take half a minute.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button
            type="submit"
            form="make-face"
            leadingIcon={<WandSparkles />}
            loading={make.isPending}
            disabled={!prompt.trim()}
          >
            Create
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
