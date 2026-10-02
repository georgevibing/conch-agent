import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { copyText } from '../../utils/clipboard';
import { cx } from '../../utils/cx';
import { IconButton, type IconButtonProps } from '../../components/IconButton';
import styles from './CopyButton.module.css';

export interface CopyButtonProps extends Omit<
  IconButtonProps,
  'children' | 'label' | 'onClick' | 'onCopy' | 'value'
> {
  /** Text to copy, or a function returning it (evaluated on click). */
  value: string | (() => string);
  /** Accessible label in the idle state. */
  label?: string;
  /** Label shown (and announced) after copying. */
  copiedLabel?: string;
  /** How long the confirmation is shown, in ms. */
  resetAfter?: number;
  onCopied?: (text: string) => void;
}

/** Icon button that copies text and confirms with an animated check. */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  resetAfter = 1600,
  onCopied,
  size = 'sm',
  className,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    const text = typeof value === 'function' ? value() : value;
    try {
      await copyText(text);
    } catch {
      return;
    }
    setCopied(true);
    onCopied?.(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), resetAfter);
  };

  return (
    <>
      <IconButton
        size={size}
        label={copied ? copiedLabel : label}
        data-copied={copied || undefined}
        className={cx(styles.copyButton, className)}
        onClick={handleCopy}
        {...props}
      >
        <span className={styles.icons}>
          <Copy className={styles.copy} />
          <Check className={styles.check} />
        </span>
      </IconButton>
      <span className="nc-visually-hidden" aria-live="polite">
        {copied ? `${copiedLabel} to clipboard` : ''}
      </span>
    </>
  );
}
