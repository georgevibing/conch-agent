/**
 * Doing something with a card in the chat (ADR 0105): save it as a picture,
 * copy it, or send it to a chat app.
 *
 * The picture is made here, in this browser (`cardPng`), because the gateway's
 * own PNG path needs a headless browser and Conch doesn't require one. Saving
 * and copying never leave the computer. **Send** does, so it goes the long way
 * round: the PNG is uploaded like any other attachment, claimed by this chat,
 * and then `POST /api/cards/send` writes it to this person's own chat in the
 * app they chose. The request carries no recipient of any kind, so nothing the
 * chat read can redirect it, and it only ever happens after a press and a
 * question naming the app.
 */
import { cardPng, CardImageError, type CardShareProps, type ShareApp } from '@conch/nacre';
import { SendableApps, SentCard } from '@conch/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, request } from '../../api/client';
import { uploadAttachment } from './uploads';

/** Space around the card in its picture, so it doesn't sit flush in a chat app. */
const PADDING = 12;

/** A caption long enough to say what it is, short enough to read on a phone. */
const CAPTION_MAX = 200;

export const cardsApi = {
  /** The chat apps a card can be sent to, most recently used first. */
  apps: (signal?: AbortSignal) => request(SendableApps, '/api/cards/apps', { signal }),
  send: (body: { conversationId: string; attachmentId: string; caption?: string; app?: string }) =>
    request(SentCard, '/api/cards/send', { method: 'POST', body }),
};

/**
 * The open chat's id, for anything drawn inside its transcript. A card is
 * drawn deep inside the tool views and doesn't know which chat it's in; the
 * share bar can't send without knowing, because the attachment it uploads has
 * to belong to this chat and no other.
 */
const ChatIdContext = createContext<string | undefined>(undefined);

export function ChatIdProvider({
  conversationId,
  children,
}: {
  conversationId?: string;
  children: ReactNode;
}) {
  return <ChatIdContext.Provider value={conversationId}>{children}</ChatIdContext.Provider>;
}

export const useChatId = () => useContext(ChatIdContext);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have taken the bytes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file name a person can find again: "Weather in Lisbon.png". */
function fileNameOf(what: string): string {
  const stem = what.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim() || 'Card';
  return `${stem.slice(0, 80)}.png`;
}

function sentence(error: unknown): string {
  if (error instanceof CardImageError || error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'That didn’t work. Try again.';
}

export interface UseCardShareOptions {
  /** What the card is, in a word: "chart", "forecast". */
  what: string;
  /** The card's title, for the file name and the caption. */
  title?: string;
  /** Words to put on the clipboard when the browser refuses a picture. */
  text?: string;
}

/**
 * The props a card's `<CardShare>` needs: the connected apps and the three
 * callbacks, wired to this browser and this chat. `ref` goes on the card's
 * root (or its `<svg>`); without it the bar does nothing, so a card that
 * can't be drawn simply doesn't mount one.
 */
export function useCardShare({ what, title, text }: UseCardShareOptions): {
  ref: (node: HTMLElement | SVGSVGElement | null) => void;
  share: Pick<CardShareProps, 'what' | 'apps' | 'onSaveImage' | 'onCopy' | 'onSend'>;
} {
  const conversationId = useChatId();
  const card = useRef<HTMLElement | SVGSVGElement | null>(null);
  const [apps, setApps] = useState<readonly ShareApp[]>([]);
  const asked = useRef(false);

  // The list is fetched the first time the bar is used, not when a card is
  // drawn: a chat full of cards shouldn't ask the gateway once per card.
  const learnApps = useCallback(async () => {
    if (asked.current) return;
    asked.current = true;
    const found = await cardsApi.apps().catch(() => undefined);
    if (found) setApps(found.apps);
  }, []);

  const picture = useCallback(async () => {
    const node = card.current;
    if (!node) throw new CardImageError('This card can’t be made into a picture.');
    // Wait for the fonts, or the words come out in the fallback face.
    await document.fonts?.ready?.catch?.(() => undefined);
    return cardPng(node, { padding: PADDING });
  }, []);

  const onSaveImage = useCallback(async () => {
    download(await picture(), fileNameOf(title ?? what));
  }, [picture, title, what]);

  const onCopy = useCallback(async (): Promise<'image' | 'text'> => {
    const blob = await picture();
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
        throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'image';
    } catch {
      // Firefox and every insecure context refuse a picture. Words are better
      // than nothing, and the bar says which it was.
      const words = text ?? title ?? what;
      if (!navigator.clipboard?.writeText)
        throw new CardImageError('This browser won’t let Conch copy a picture.');
      await navigator.clipboard.writeText(words);
      return 'text';
    }
  }, [picture, text, title, what]);

  const onSend = useCallback(
    async (app: ShareApp) => {
      if (!conversationId)
        throw new CardImageError('Send this once the chat has been saved — give it a moment.');
      const blob = await picture();
      const name = fileNameOf(title ?? what);
      const attachment = await uploadAttachment(blob, { name });
      const caption = (title ? `${title}` : what).slice(0, CAPTION_MAX);
      await cardsApi.send({
        conversationId,
        attachmentId: attachment.id,
        caption,
        app: app.name,
      });
    },
    [conversationId, picture, title, what],
  );

  const ref = useCallback(
    (node: HTMLElement | SVGSVGElement | null) => {
      card.current = node;
      if (node) void learnApps();
    },
    [learnApps],
  );

  const share = useMemo(
    () => ({
      what,
      apps,
      onSaveImage: () => onSaveImage().catch((error: unknown) => failWith(error)),
      onCopy: () => onCopy().catch((error: unknown) => failWith(error)),
      ...(conversationId && {
        onSend: (app: ShareApp) => onSend(app).catch((error: unknown) => failWith(error)),
      }),
    }),
    [what, apps, onSaveImage, onCopy, onSend, conversationId],
  );

  return { ref, share };
}

/** Re-throw with a sentence the bar can show as it is. */
function failWith(error: unknown): never {
  throw new CardImageError(sentence(error));
}
