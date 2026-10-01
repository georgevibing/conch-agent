import type { ComponentProps, CSSProperties } from 'react';

import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import styles from './CommandLine.module.css';

export interface CommandLineProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The one line to run. */
  command: string;
  /** The prompt glyph before it: `$` for a shell, `>` for PowerShell. Never copied. */
  prompt?: string;
  size?: 'md' | 'lg';
  /** Types itself out once, when it appears. The whole line is there for screen readers and Copy from the start. */
  typed?: boolean;
  /** The copy button's name. */
  copyLabel?: string;
}

/**
 * One command, ready to copy: the line someone pastes into a terminal to
 * start. A single line by design — anything longer is a `CodeBlock`.
 */
export function CommandLine({
  command,
  prompt = '$',
  size = 'md',
  typed = false,
  copyLabel = 'Copy command',
  className,
  style,
  ...props
}: CommandLineProps) {
  return (
    <div
      data-lustre=""
      data-size={size}
      className={cx(styles.line, className)}
      style={{ '--cl-chars': command.length, ...style } as CSSProperties}
      {...props}
    >
      <span className={styles.prompt} aria-hidden>
        {prompt}
      </span>
      <div
        className={styles.scroll}
        // What scrolls must be reachable from the keyboard (WCAG 2.1.1). A group, not
        // a region: a page of commands would otherwise be a page of identical landmarks.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="group"
        aria-label="Command"
      >
        {/* A <pre> with a language, so Prose leaves it alone as it does a CodeBlock. */}
        <pre className={styles.pre} data-language="shell">
          <code className={styles.code} data-typed={typed || undefined}>
            {command}
          </code>
        </pre>
      </div>
      <CopyButton value={command} label={copyLabel} className={styles.copy} />
    </div>
  );
}
