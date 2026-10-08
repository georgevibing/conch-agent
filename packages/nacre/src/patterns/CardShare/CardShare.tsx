import { Check, Copy, ImageDown, Send } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Popover } from '../../components/Popover';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './CardShare.module.css';

/** A chat app this person is reachable on (`channels.sendable()` on the gateway). */
export interface ShareApp {
  /** The channel's id, unique in the list. */
  id: string;
  /** `telegram`, `whatsapp`, `slack`… — picks the logo. */
  kind: string;
  /** What it's called, as a person says it: "Telegram". */
  name: string;
  /** Its brand colour, for the logo tile. */
  color?: string;
}

/** What the bar is doing, so a card or a story can drive it. */
export type ShareDoing =
  | { kind: 'saving' }
  | { kind: 'copying' }
  | { kind: 'sending'; app: ShareApp }
  | { kind: 'sent'; app: ShareApp }
  | { kind: 'copied'; as: 'image' | 'text' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }
  | null;

export interface CardShareProps extends Omit<ComponentProps<'div'>, 'children' | 'onCopy'> {
  /**
   * What this card is, in one word, for the names and the question: "chart",
   * "forecast", "card". "Send this chart to Telegram?"
   */
  what?: string;
  /**
   * The chat apps the person can be reached on, the one they wrote from last
   * first. Empty or left out and **Send** isn't there at all.
   */
  apps?: readonly ShareApp[];
  /** Save the picture to this computer. */
  onSaveImage?: () => Promise<void> | void;
  /**
   * Put the picture on the clipboard. Say `'text'` when the browser refused a
   * picture and words went instead, so the bar can say which it was.
   */
  onCopy?: () => 'image' | 'text' | Promise<'image' | 'text'>;
  /**
   * Send the picture to that app's own chat with this person. Only ever called
   * after they pressed **Send**, chose the app and confirmed it by name.
   */
  onSend?: (app: ShareApp) => Promise<void> | void;
  /** Say what happened, after it happened. The bar also shows it for a moment. */
  onDone?: (done: Exclude<ShareDoing, null>) => void;
  /** The menu's open state, when the card holds it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The app the question is about, when the card holds it. */
  confirming?: string | null;
  onConfirmingChange?: (appId: string | null) => void;
  /** What the bar is doing, when the card holds it. */
  doing?: ShareDoing;
  /** Extra buttons, before the three. */
  extra?: ReactNode;
}

/** How long "Saved", "Copied" or "Sent" stays on the bar. */
const SETTLE_MS = 2000;

const resultWords = (doing: Exclude<ShareDoing, null>): string => {
  switch (doing.kind) {
    case 'saved':
      return 'Saved';
    case 'copied':
      return doing.as === 'text' ? 'Copied as text' : 'Copied';
    case 'sent':
      return `Sent to ${doing.app.name}`;
    case 'failed':
      return doing.message;
    case 'saving':
      return 'Saving…';
    case 'copying':
      return 'Copying…';
    case 'sending':
      return `Sending to ${doing.app.name}…`;
  }
};

/**
 * The share bar every card wears in its footer (ADR 0105): **Save as image**,
 * **Copy**, and **Send** to a chat app. Three quiet icon buttons that only say
 * their names when a pointer rests on them or the keyboard reaches them.
 *
 * **Send** is the one that leaves this computer, so it asks twice over: the
 * press opens a list of the apps this person is actually reachable on (the one
 * they wrote from last at the top), and choosing one asks the question with the
 * app in it — "Send this chart to Telegram?" — before anything goes. Nothing
 * here is automatic, nothing is silent, and with no app connected there's no
 * **Send** button at all rather than one that can't work.
 *
 * It knows nothing of chat apps or the gateway: the card passes the list and
 * the three callbacks.
 */
export function CardShare({
  what = 'card',
  apps,
  onSaveImage,
  onCopy,
  onSend,
  onDone,
  open: openProp,
  onOpenChange,
  confirming: confirmingProp,
  onConfirmingChange,
  doing: doingProp,
  extra,
  className,
  ...props
}: CardShareProps) {
  const headingId = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownConfirming, setOwnConfirming] = useState<string | null>(null);
  const [ownDoing, setOwnDoing] = useState<ShareDoing>(null);
  const open = openProp ?? ownOpen;
  const confirming = confirmingProp === undefined ? ownConfirming : confirmingProp;
  const doing = doingProp === undefined ? ownDoing : doingProp;
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
    if (!next) setConfirming(null);
  };
  const setConfirming = (next: string | null) => {
    if (confirmingProp === undefined) setOwnConfirming(next);
    onConfirmingChange?.(next);
  };
  const report = (next: Exclude<ShareDoing, null>) => {
    if (doingProp === undefined) {
      setOwnDoing(next);
      clearTimeout(settle.current);
      settle.current = setTimeout(() => setOwnDoing(null), SETTLE_MS);
    }
    onDone?.(next);
  };
  const start = (next: ShareDoing) => {
    if (doingProp === undefined) {
      clearTimeout(settle.current);
      setOwnDoing(next);
    }
  };

  const failure = (error: unknown) =>
    report({
      kind: 'failed',
      message:
        error instanceof Error && error.message ? error.message : 'That didn’t work. Try again.',
    });

  const save = async () => {
    if (!onSaveImage) return;
    start({ kind: 'saving' });
    try {
      await onSaveImage();
      report({ kind: 'saved' });
    } catch (error) {
      failure(error);
    }
  };

  const copy = async () => {
    if (!onCopy) return;
    start({ kind: 'copying' });
    try {
      const as = await onCopy();
      report({ kind: 'copied', as: as === 'text' ? 'text' : 'image' });
    } catch (error) {
      failure(error);
    }
  };

  const send = async (app: ShareApp) => {
    if (!onSend) return;
    setOpen(false);
    start({ kind: 'sending', app });
    try {
      await onSend(app);
      report({ kind: 'sent', app });
    } catch (error) {
      failure(error);
    }
  };

  const busy = doing?.kind === 'saving' || doing?.kind === 'copying' || doing?.kind === 'sending';
  const chosen = apps?.find((a) => a.id === confirming);
  const canSend = Boolean(onSend && apps?.length);
  const settled =
    doing && (doing.kind === 'saved' || doing.kind === 'copied' || doing.kind === 'sent');

  return (
    <div
      className={cx(styles.bar, className)}
      data-share-hide=""
      data-busy={busy || undefined}
      {...props}
    >
      {extra}
      {onSaveImage && (
        <IconButton
          size="sm"
          label="Save as image"
          className={styles.action}
          loading={doing?.kind === 'saving'}
          data-done={doing?.kind === 'saved' || undefined}
          onClick={() => void save()}
        >
          {doing?.kind === 'saved' ? <Check /> : <ImageDown />}
        </IconButton>
      )}
      {onCopy && (
        <IconButton
          size="sm"
          label="Copy"
          className={styles.action}
          loading={doing?.kind === 'copying'}
          data-done={doing?.kind === 'copied' || undefined}
          onClick={() => void copy()}
        >
          {doing?.kind === 'copied' ? <Check /> : <Copy />}
        </IconButton>
      )}
      {canSend && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          {/* The hint sits outside the trigger so one element carries both. */}
          <Tooltip content="Send">
            <PopoverPrimitive.Trigger asChild>
              <IconButton
                size="sm"
                label="Send"
                tooltip={false}
                className={styles.action}
                loading={doing?.kind === 'sending'}
                data-done={doing?.kind === 'sent' || undefined}
              >
                {doing?.kind === 'sent' ? <Check /> : <Send />}
              </IconButton>
            </PopoverPrimitive.Trigger>
          </Tooltip>
          <Popover.Content
            padding="none"
            align="end"
            className={styles.menu}
            aria-label={chosen ? `Send this ${what} to ${chosen.name}?` : `Send this ${what}`}
          >
            {chosen ? (
              <div className={styles.confirm}>
                <p className={styles.question}>
                  Send this {what} to {chosen.name}?
                </p>
                <p className={styles.note}>
                  It goes to your own chat on {chosen.name}, as a picture.
                </p>
                <div className={styles.buttons}>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="solid" onClick={() => void send(chosen)}>
                    Send to {chosen.name}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className={styles.heading} id={headingId}>
                  Send this {what} to
                </p>
                <ul className={styles.apps} aria-labelledby={headingId}>
                  {apps?.map((app) => (
                    <li key={app.id}>
                      <button
                        type="button"
                        className={styles.app}
                        data-lustre=""
                        onClick={() => setConfirming(app.id)}
                      >
                        <IntegrationLogo
                          brand={app.kind}
                          name={app.name}
                          color={app.color}
                          size="xs"
                          decorative
                        />
                        <span className={styles.appName}>{app.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Popover.Content>
        </Popover.Root>
      )}
      {/* One place says what happened, and it's the one that announces it:
          a second, hidden copy would be read twice. While it's working the
          words are there for a screen reader but folded away on screen. */}
      <span
        className={styles.said}
        aria-live="polite"
        data-tone={doing?.kind === 'failed' ? 'bad' : undefined}
        data-shown={settled || doing?.kind === 'failed' ? '' : undefined}
      >
        {doing ? resultWords(doing) : ''}
      </span>
    </div>
  );
}
