import {
  FilePen,
  Globe,
  HardDrive,
  KeyRound,
  MousePointerClick,
  Plug,
  SquareTerminal,
} from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './SkillTrust.module.css';

export type SkillCapabilityName =
  'commands' | 'files' | 'files-anywhere' | 'web' | 'browser' | 'apps' | 'passwords';

const ICONS: Record<SkillCapabilityName, ReactNode> = {
  commands: <SquareTerminal />,
  files: <FilePen />,
  'files-anywhere': <HardDrive />,
  web: <Globe />,
  browser: <MousePointerClick />,
  apps: <Plug />,
  passwords: <KeyRound />,
};

export interface SkillPermissionListProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** What it may do, and the same in words ("run commands (only `git`)"), in order. */
  capabilities: SkillCapabilityName[];
  words: string[];
  /** The skill said; otherwise these are the usual ones and the list says so. */
  declared: boolean;
  /** `compact` for a dialog: no heading of its own. */
  variant?: 'page' | 'compact';
}

/** `run commands (only `git`)`: backticks as code, the rest as words. */
function phrase(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
    );
}

/**
 * What a skill may do while it's in use (ADR 0031), in plain words: "This
 * skill can: run commands (only `git`), change files in your work folder".
 * Anything else it tries asks you first. A skill that doesn't say gets the
 * usual list, and this says that too.
 */
export function SkillPermissionList({
  capabilities,
  words,
  declared,
  variant = 'page',
  className,
  ...props
}: SkillPermissionListProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.permissions, className)}
      data-variant={variant}
      {...props}
    >
      <p className={styles.heading} id={titleId}>
        {capabilities.length ? 'This skill can:' : 'This skill can only read and look things up.'}
      </p>
      {capabilities.length > 0 && (
        <ul className={styles.can}>
          {capabilities.map((capability, i) => (
            <li key={capability}>
              <span className={styles.canIcon} aria-hidden>
                {ICONS[capability]}
              </span>
              <span>{phrase(words[i] ?? capability)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.fine}>
        {declared
          ? 'Anything else it tries asks you first, whatever the mode.'
          : 'It doesn’t say what it needs, so it gets the usual. Anything else it tries asks you first, whatever the mode.'}
      </p>
    </section>
  );
}
