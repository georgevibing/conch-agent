import { ArrowUp, FileText, Image as ImageIcon, Square, X } from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { Kbd } from '../../components/Kbd';
import { cx } from '../../utils/cx';
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
  /** Controls on the left of the footer (model picker, mode toggles…). */
  toolbar?: ReactNode;
  /** Controls on the right of the footer, before the send button. */
  actions?: ReactNode;
  /** Ref to the underlying `<textarea>`. */
  ref?: Ref<HTMLTextAreaElement>;
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
  toolbar,
  actions,
  ref,
  className,
  ...props
}: ComposerProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const controlled = valueProp !== undefined;
  const value = controlled ? valueProp : uncontrolled;
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();

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

  const canSubmit = !disabled && value.trim().length > 0 && (!running || allowSubmitWhileRunning);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit?.(value.trim());
    if (!controlled) setUncontrolled('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Never act while an IME composition is in progress (CJK input etc.).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && running && onStop) {
      event.preventDefault();
      onStop();
    }
  };

  const showStop = running && !(allowSubmitWhileRunning && value.trim());

  return (
    <div
      data-running={running || undefined}
      data-disabled={disabled || undefined}
      className={cx(styles.frame, className)}
      {...props}
    >
      <span className={styles.glow} aria-hidden />
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
        {attachments && (
          <div className={styles.attachments} role="list" aria-label="Attachments">
            {attachments}
          </div>
        )}
        <textarea
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
        />
        <div className={styles.footer}>
          <div className={styles.toolbar}>{toolbar}</div>
          <div className={styles.end}>
            <span id={hintId} className="nc-visually-hidden">
              {running && onStop
                ? 'Press Escape to stop.'
                : 'Press Enter to send, Shift+Enter for a new line.'}
            </span>
            <span className={styles.hint} aria-hidden>
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
            {actions}
            <IconButton
              variant="solid"
              tone={showStop ? 'neutral' : 'accent'}
              shape="circle"
              size="sm"
              label={showStop ? 'Stop' : 'Send message'}
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
