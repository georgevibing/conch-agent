import { CheckCircle2, ClipboardPaste } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import styles from './KeyField.module.css';

export type KeyFieldStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface KeyFieldProps {
  label: string;
  /** Where to find it, in a sentence. */
  description?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  status: KeyFieldStatus;
  /** While checking: "Checking with Telegram…". */
  checkingLabel?: string;
  /** When good: who it belongs to ("Found @my_conch_bot"), with its picture. */
  found?: ReactNode;
  /** When wrong: what's wrong and what to do. */
  error?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Where a person pastes a key. It's checked as soon as it lands — no Save
 * button to find — and says right under it whose key it is, or exactly what's
 * wrong. Paste works from the keyboard, the context menu, or the button
 * (which reads the clipboard in one tap). The key stays masked unless asked.
 */
export function KeyField({
  label,
  description,
  value,
  onValueChange,
  placeholder,
  status,
  checkingLabel = 'Checking…',
  found,
  error,
  autoFocus,
  className,
}: KeyFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [pasteHint, setPasteHint] = useState(false);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onValueChange(text.trim());
        setPasteHint(false);
        return;
      }
    } catch {
      // The browser said no (or asked and was told no): the keyboard still works.
    }
    setPasteHint(true);
    input.current?.focus();
  };

  return (
    <Field invalid={status === 'error'} className={cx(styles.field, className)}>
      <Field.Label>{label}</Field.Label>
      <div className={styles.row}>
        <PasswordInput
          ref={input}
          value={value}
          onChange={(e) => {
            setPasteHint(false);
            onValueChange(e.target.value);
          }}
          placeholder={placeholder}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the one thing to do on this step
          autoFocus={autoFocus}
          data-status={status}
          className={styles.input}
        />
        <Button variant="surface" leadingIcon={<ClipboardPaste />} onClick={() => void paste()}>
          Paste
        </Button>
      </div>
      {status === 'checking' && (
        <p className={styles.status} aria-live="polite">
          <Spinner size="xs" label={null} />
          {checkingLabel}
        </p>
      )}
      {status === 'ok' && found && (
        <p className={cx(styles.status, styles.ok)} aria-live="polite">
          <CheckCircle2 size={16} aria-hidden className={styles.okIcon} />
          {found}
        </p>
      )}
      {status === 'error' && <Field.Error>{error}</Field.Error>}
      {pasteHint && status !== 'error' && (
        <Field.Description>Press Ctrl+V (⌘V on a Mac) to paste it here.</Field.Description>
      )}
      {description && status !== 'ok' && !pasteHint && (
        <Field.Description>{description}</Field.Description>
      )}
    </Field>
  );
}
