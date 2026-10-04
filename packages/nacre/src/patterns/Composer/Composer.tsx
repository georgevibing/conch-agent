import {
  ArrowUp,
  CornerDownRight,
  FileText,
  Image as ImageIcon,
  Pencil,
  Plus,
  Square,
  X,
} from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { cx } from '../../utils/cx';
import picker from '../ModelPicker/ModelPicker.module.css';
import styles from './Composer.module.css';

export interface ComposerProps extends Omit<
  ComponentProps<'div'>,
  'onSubmit' | 'defaultValue' | 'ref'
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Called with the trimmed message on Enter or the send button. */
  onSubmit?: (value: string) => void;
  /** Called when the user presses Stop (or Esc) while `running`. */
  onStop?: () => void;
  /** The agent is working: shows the orbiting pearl rim and turns Send into Stop. */
  running?: boolean;
  /** Allow sending (queueing) a follow-up while `running`. */
  allowSubmitWhileRunning?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name for the text field. */
  label?: string;
  minRows?: number;
  maxRows?: number;
  autoFocus?: boolean;
  name?: string;
  /** Attachment chips shown above the text field (use `ComposerAttachment`). */
  attachments?: ReactNode;
  /** A message waiting to go once the agent is done, above everything (use `ComposerQueued`). */
  queued?: ReactNode;
  /** Controls on the left of the footer (model picker, mode toggles…). */
  toolbar?: ReactNode;
  /** Controls on the right of the footer, before the send button. */
  actions?: ReactNode;
  /** Ref to the underlying `<textarea>`. */
  ref?: Ref<HTMLTextAreaElement>;
  /**
   * Runs before the composer's own key handling. Call `event.preventDefault()`
   * to claim the key (e.g. Enter while a command menu is open).
   */
  onTextareaKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Extra attributes for the `<textarea>` (e.g. combobox ARIA from `useCommandMenu`). */
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'onChange' | 'onKeyDown' | 'defaultValue'
  >;
  /** Floating content anchored to the composer, e.g. a `CommandMenu`. */
  overlay?: ReactNode;
  /**
   * Files to attach: picked with the attach button, or pasted (a screenshot).
   * Giving it shows the attach button.
   */
  onFiles?: (files: File[]) => void;
  /** Types the file picker offers first (the `accept` attribute). Any file can still be chosen. */
  accept?: string;
  /**
   * A paste too long to write around: attach it as a card instead of pouring
   * it into the box. Shift+paste always pastes inline.
   */
  onLongPaste?: (text: string) => void;
  /** Which pastes count as long. Defaults to more than 1 000 characters or 20 lines. */
  foldPaste?: (text: string) => boolean;
  /** Send even with nothing typed (the message is its attachments). */
  canSubmitEmpty?: boolean;
  /** Hold sending, and say why on the button (e.g. "Waiting for uploads…"). */
  sendBlocked?: string;
  /** What the send button does, when it isn't plain sending (e.g. "Send when it’s done"). */
  sendLabel?: string;
  /**
   * Messages sent before, oldest first. ↑ in an empty box brings back the
   * latest, and again the one before; ↓ walks forward, past the newest to an
   * empty box. A recalled message you change is yours: the arrows move the
   * caret again.
   */
  history?: readonly string[];
}

/** More than 1 000 characters or 20 lines: Codex CLI's and Open WebUI's threshold (ADR 0017). */
export function defaultFoldPaste(text: string): boolean {
  if (text.length > 1000) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++lines > 20) return true;
  return false;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * The chat input. Grows with its content, sends on Enter (Shift+Enter for a
 * newline, IME-safe), and — while the agent is working — wears an orbiting
 * band of pearl light while Send becomes Stop.
 */
export function Composer({
  value: valueProp,
  defaultValue = '',
  onValueChange,
  onSubmit,
  onStop,
  running = false,
  allowSubmitWhileRunning = false,
  disabled = false,
  placeholder = 'Ask Claude anything…',
  label = 'Message',
  minRows = 1,
  maxRows = 12,
  autoFocus,
  name,
  attachments,
  queued,
  toolbar,
  actions,
  ref,
  onTextareaKeyDown,
  textareaProps,
  overlay,
  onFiles,
  accept,
  onLongPaste,
  foldPaste = defaultFoldPaste,
  canSubmitEmpty = false,
  sendBlocked,
  sendLabel = 'Send message',
  history,
  className,
  ...props
}: ComposerProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const controlled = valueProp !== undefined;
  const value = controlled ? valueProp : uncontrolled;
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  /** The paste in progress came with Shift (⇧⌘V / Ctrl+Shift+V): keep it inline. */
  const shiftPaste = useRef(false);
  const hintId = useId();
  /** Which of `history` the box shows, while it shows one unchanged. */
  const recalled = useRef<number | null>(null);
  /** A message just came back from history: put the caret at its end once it's in. */
  const caretToEnd = useRef(false);

  const setValue = useCallback(
    (next: string) => {
      if (!controlled) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  // Autosize between minRows and maxRows.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = Number.parseFloat(style.lineHeight) || 22;
    const chrome = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const min = line * minRows + chrome;
    const max = line * maxRows + chrome;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, min), max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);

  useLayoutEffect(() => {
    const el = textarea.current;
    if (!caretToEnd.current || !el) return;
    caretToEnd.current = false;
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [value]);

  /** ↑ / ↓ through what was sent before, the way a terminal does. True if it took the key. */
  const walkHistory = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!history?.length) return false;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
    const up = event.key === 'ArrowUp';
    if (!up && event.key !== 'ArrowDown') return false;
    const el = event.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return false;
    const at = recalled.current;
    const showing = at !== null && history[at] === value;
    if (!showing) recalled.current = null;
    // Only from the edge of the text, so the arrows still move through a long message.
    const edge = up
      ? !value.slice(0, el.selectionStart).includes('\n')
      : !value.slice(el.selectionEnd).includes('\n');
    if (!edge) return false;
    let next: number | null;
    if (up) {
      if (showing) next = at > 0 ? at - 1 : at;
      else if (!value) next = history.length - 1;
      else return false;
    } else {
      if (!showing) return false;
      next = at + 1 < history.length ? at + 1 : null;
    }
    event.preventDefault();
    if (next === at) return true;
    recalled.current = next;
    caretToEnd.current = true;
    setValue(next === null ? '' : (history[next] ?? ''));
    return true;
  };

  const hasContent = value.trim().length > 0 || canSubmitEmpty;
  const canSubmit =
    !disabled && hasContent && !sendBlocked && (!running || allowSubmitWhileRunning);

  const submit = () => {
    if (!canSubmit) return;
    recalled.current = null;
    onSubmit?.(value.trim());
    if (!controlled) setUncontrolled('');
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    textareaProps?.onPaste?.(event);
    const shift = shiftPaste.current;
    shiftPaste.current = false;
    if (event.defaultPrevented) return;
    const data = event.clipboardData;
    const text = data.getData('text/plain');
    // A copied screenshot or file. Office apps put a picture of the cells next
    // to the text, so the text wins when there is some.
    const files = Array.from(data.files ?? []);
    if (onFiles && files.length && !text) {
      event.preventDefault();
      onFiles(files);
      return;
    }
    if (onLongPaste && text && !shift && foldPaste(text)) {
      event.preventDefault();
      onLongPaste(text);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    shiftPaste.current =
      event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v';
    onTextareaKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Never act while an IME composition is in progress (CJK input etc.).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (walkHistory(event)) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && running && onStop) {
      event.preventDefault();
      onStop();
    }
  };

  const showStop = running && !(allowSubmitWhileRunning && hasContent);

  return (
    <div
      data-running={running || undefined}
      data-disabled={disabled || undefined}
      className={cx(styles.frame, className)}
      {...props}
    >
      <span className={styles.glow} aria-hidden />
      {overlay}
      <div
        className={styles.surface}
        data-lustre=""
        data-lustre-ambient={running ? '' : undefined}
        // Clicking the padding focuses the field, like a native input.
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            textarea.current?.focus();
          }
        }}
      >
        {queued}
        {attachments && (
          <div className={styles.attachments} role="list" aria-label="Attachments">
            {attachments}
          </div>
        )}
        <textarea
          {...textareaProps}
          ref={(el) => {
            textarea.current = el;
            assignRef(ref, el);
          }}
          className={styles.textarea}
          rows={minRows}
          value={value}
          name={name}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={hintId}
          disabled={disabled}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in for chat surfaces
          autoFocus={autoFocus}
          enterKeyHint="send"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className={styles.footer}>
          <div className={styles.toolbar}>
            {onFiles && (
              <>
                <IconButton
                  size="sm"
                  shape="circle"
                  label="Attach files"
                  className={styles.attach}
                  disabled={disabled}
                  onClick={() => picker.current?.click()}
                >
                  <Plus />
                </IconButton>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  accept={accept}
                  hidden
                  tabIndex={-1}
                  aria-hidden
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    // Cleared so choosing the same file again still counts.
                    event.target.value = '';
                    if (files.length) onFiles(files);
                    textarea.current?.focus();
                  }}
                />
              </>
            )}
            {toolbar}
          </div>
          <span id={hintId} className="nc-visually-hidden">
            {running && onStop
              ? 'Press Escape to stop.'
              : 'Press Enter to send, Shift+Enter for a new line.'}
          </span>
          {/* Takes only the space the toolbar leaves over, and bows out when that's too little. */}
          <span className={styles.hintSlot} aria-hidden>
            <span className={styles.hint}>
              {running && onStop ? (
                <>
                  <Kbd keys="esc" size="sm" /> to stop
                </>
              ) : (
                <>
                  <Kbd keys="enter" size="sm" /> to send · <Kbd keys="shift+enter" size="sm" /> new
                  line
                </>
              )}
            </span>
          </span>
          <div className={styles.end}>
            {actions}
            <IconButton
              variant="solid"
              tone={showStop ? 'neutral' : 'accent'}
              shape="circle"
              size="sm"
              label={showStop ? 'Stop' : (sendBlocked ?? sendLabel)}
              shortcut={showStop ? 'esc' : 'enter'}
              data-mode={showStop ? 'stop' : 'send'}
              className={styles.send}
              disabled={showStop ? !onStop : !canSubmit}
              onClick={showStop ? onStop : submit}
            >
              <span className={styles.sendIcons}>
                <ArrowUp className={styles.arrow} />
                <Square className={styles.stop} />
              </span>
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface ComposerChipProps extends ComponentProps<'button'> {
  /** Icon before the label; stays visible when the label is squeezed out. */
  icon?: ReactNode;
}

/**
 * A quiet toolbar button that matches the model and mode chips, e.g. the
 * working folder. When the footer runs out of room it gives way first: the
 * label truncates, down to the icon alone. Wrap it in a `Tooltip` with the
 * full text and give it an `aria-label`, so nothing is lost when it does.
 */
export function ComposerChip({
  icon,
  type = 'button',
  className,
  children,
  ...props
}: ComposerChipProps) {
  return (
    <button
      type={type}
      data-lustre=""
      className={cx(picker.chip, styles.chip, className)}
      {...props}
    >
      {icon != null && (
        <span className={styles.chipIcon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={picker.chipLabel}>{children}</span>
    </button>
  );
}

export interface ComposerAttachmentProps extends ComponentProps<'div'> {
  name: string;
  /** Secondary text, e.g. size or line range. */
  meta?: ReactNode;
  kind?: 'file' | 'image';
  /** Image preview URL for `kind="image"`. */
  previewUrl?: string;
  onRemove?: () => void;
}

/** A removable chip representing a file or image attached to the message. */
export function ComposerAttachment({
  name,
  meta,
  kind = 'file',
  previewUrl,
  onRemove,
  className,
  ...props
}: ComposerAttachmentProps) {
  const Icon = kind === 'image' ? ImageIcon : FileText;
  return (
    <div role="listitem" className={cx(styles.attachment, className)} {...props}>
      <span className={styles.attachmentThumb} aria-hidden>
        {previewUrl ? <img src={previewUrl} alt="" /> : <Icon />}
      </span>
      <span className={styles.attachmentText}>
        <span className={styles.attachmentName}>{name}</span>
        {meta != null && <span className={styles.attachmentMeta}>{meta}</span>}
      </span>
      {onRemove && (
        <IconButton
          size="sm"
          shape="circle"
          label={`Remove ${name}`}
          tooltip={false}
          className={styles.attachmentRemove}
          onClick={onRemove}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}

export interface ComposerQueuedProps extends ComponentProps<'div'> {
  /** The message that waits. */
  text: string;
  /** Who it waits for, e.g. "Sends when Conch is done". */
  meta?: ReactNode;
  /** Take it back into the box to change it. */
  onEdit?: () => void;
  /** Don't send it. */
  onRemove?: () => void;
}

/**
 * A message you sent while the agent was still working: it waits here, and
 * goes by itself the moment the reply is over. Edit takes it back into the box.
 */
export function ComposerQueued({
  text,
  meta,
  onEdit,
  onRemove,
  className,
  ...props
}: ComposerQueuedProps) {
  return (
    <div
      role="status"
      aria-label="Queued message"
      className={cx(styles.queued, className)}
      {...props}
    >
      <CornerDownRight className={styles.queuedIcon} aria-hidden />
      <span className={styles.queuedText}>
        <span className={styles.queuedMessage}>{text}</span>
        {meta != null && <span className={styles.queuedMeta}>{meta}</span>}
      </span>
      {onEdit && (
        <IconButton size="sm" shape="circle" label="Edit queued message" onClick={onEdit}>
          <Pencil />
        </IconButton>
      )}
      {onRemove && (
        <IconButton size="sm" shape="circle" label="Don’t send queued message" onClick={onRemove}>
          <X />
        </IconButton>
      )}
    </div>
  );
}
